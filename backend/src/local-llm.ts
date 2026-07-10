const FALSEY = new Set(['0', 'false', 'no', 'off'])
const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

export const LOCAL_LLM_OPENAI_COMPATIBLE_TYPES = new Set([
  'litellm',
  'llm',
  'llm-proxy',
  'openai-compatible',
  'openai_compatible',
  'vllm',
  'lmstudio',
])

export interface LocalLlmResolvedConfig {
  name: string
  type: string
  base_url: string
  model?: string
  api_key?: string
  api_key_configured: boolean
  autodiscovered?: boolean
  discovery_error?: string
}

interface DiscoveryCandidate {
  type: string
  baseUrl: string
  label: string
}

// Hosts probed when local LLM is enabled without an explicit host/base URL.
export const DEFAULT_DISCOVERY_HOSTS = ['host.docker.internal', 'localhost']

function normalizeFlag(value: string | undefined): boolean | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  if (TRUTHY.has(normalized)) return true
  if (FALSEY.has(normalized)) return false
  return null
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function normalizeHostToHttpBase(host: string): string {
  const trimmed = host.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `http://${trimmed}`
}

function portOf(value: string): string {
  try {
    return new URL(value).port
  } catch {
    return ''
  }
}

function baseHasExplicitPort(value: string): boolean {
  return Boolean(portOf(value))
}

function canonicalLocalLlmType(value: string | undefined, baseUrl?: string): string {
  const normalized = value?.trim().toLowerCase()
  if (!normalized || normalized === 'auto') return inferTypeFromBaseUrl(baseUrl)
  if (normalized === 'llama.cpp' || normalized === 'llama-cpp' || normalized === 'llamacpp') return 'llamacpp'
  if (normalized === 'lite-llm' || normalized === 'lite_llm' || normalized === 'litellm') return 'litellm'
  if (normalized === 'lm-studio' || normalized === 'lm_studio' || normalized === 'lmstudio') return 'lmstudio'
  if (normalized === 'llmproxy' || normalized === 'llm_proxy' || normalized === 'llm-proxy') return 'llm-proxy'
  if (normalized === 'openai-compatible' || normalized === 'openai_compatible') return 'llm'
  return normalized
}

function inferTypeFromBaseUrl(baseUrl?: string): string {
  if (!baseUrl) return 'ollama'
  const normalized = normalizeBaseUrl(baseUrl)
  if (normalized.endsWith('/v1')) {
    const port = portOf(normalized)
    if (port === '1234') return 'lmstudio'
    if (port === '8000') return 'vllm'
    if (port === '4000') return 'llm-proxy'
    if (port === '8080') return 'llamacpp'
    return 'litellm'
  }
  if (portOf(normalized) === '11434') return 'ollama'
  return 'litellm'
}

async function fetchJson(url: string, headers: Record<string, string> = {}, timeoutMs = 1200): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { headers, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

// A generic web app can 200 anything (SPA fallbacks return HTML for
// /v1/models), so response.ok alone is not proof of an LLM server — require
// the body to actually parse as a models list.
async function looksLikeModelsList(response: Response): Promise<boolean> {
  if (!response.ok) return false
  try {
    const body = await response.json() as { data?: unknown; models?: unknown }
    return Array.isArray(body) || Array.isArray(body?.data) || Array.isArray(body?.models)
  } catch {
    return false
  }
}

async function probeCandidate(candidate: DiscoveryCandidate, apiKey?: string): Promise<boolean> {
  const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
  try {
    if (candidate.type === 'ollama') {
      const response = await fetchJson(`${candidate.baseUrl}/api/tags`)
      if (!response.ok) return false
      const data = await response.json() as { models?: Array<{ name?: string }> }
      return Array.isArray(data.models)
    }

    if (candidate.type === 'llamacpp') {
      const modelsResponse = await fetchJson(`${candidate.baseUrl}/v1/models`, headers)
      if (await looksLikeModelsList(modelsResponse)) return true
      // llama.cpp's health endpoint returns exactly {"status":"ok"}
      const healthResponse = await fetchJson(`${candidate.baseUrl}/health`, headers)
      if (!healthResponse.ok) return false
      const health = await healthResponse.json().catch(() => null) as { status?: unknown } | null
      return health?.status === 'ok'
    }

    const v1Response = await fetchJson(`${candidate.baseUrl}/v1/models`, headers)
    if (await looksLikeModelsList(v1Response)) return true
    const modelsResponse = await fetchJson(`${candidate.baseUrl}/models`, headers)
    return looksLikeModelsList(modelsResponse)
  } catch {
    return false
  }
}

function allCandidatesFor(base: string): DiscoveryCandidate[] {
  return [
    { type: 'ollama', baseUrl: `${base}:11434`, label: 'Ollama' },
    { type: 'lmstudio', baseUrl: `${base}:1234/v1`, label: 'LM Studio' },
    { type: 'vllm', baseUrl: `${base}:8000/v1`, label: 'vLLM' },
    { type: 'llamacpp', baseUrl: `${base}:8080`, label: 'llama.cpp' },
    { type: 'llm-proxy', baseUrl: `${base}:4000/v1`, label: 'LLM proxy' },
    { type: 'litellm', baseUrl: `${base}:3000/v1`, label: 'OpenAI-compatible server' },
  ]
}

export interface DiscoveredEndpoint {
  type: string
  base_url: string
  label: string
  models: string[]
}

/** List model names served by a local endpoint (empty array on failure). */
export async function listEndpointModels(type: string, baseUrl: string, apiKey?: string): Promise<string[]> {
  const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
  try {
    if (type === 'ollama') {
      const response = await fetchJson(`${baseUrl}/api/tags`)
      if (!response.ok) return []
      const data = await response.json() as { models?: Array<{ name?: string }> }
      return (data.models ?? []).map((m) => m.name).filter((n): n is string => Boolean(n))
    }
    const base = /\/v1$/.test(baseUrl) ? baseUrl : `${baseUrl}/v1`
    const response = await fetchJson(`${base}/models`, headers)
    if (!response.ok) return []
    const data = await response.json() as { data?: Array<{ id?: string }> }
    return (data.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id))
  } catch {
    return []
  }
}

/**
 * Probe every known local-LLM server type on the given hosts in parallel and
 * return all reachable endpoints with their model lists. Used by the setup
 * wizard's detection-first QuickStart path.
 */
export async function discoverLocalLlmEndpoints(
  hosts: string[] = DEFAULT_DISCOVERY_HOSTS,
  apiKey?: string,
): Promise<DiscoveredEndpoint[]> {
  const candidates = hosts
    .map(normalizeHostToHttpBase)
    .filter(Boolean)
    .flatMap(allCandidatesFor)

  const probed = await Promise.all(candidates.map(async (candidate) => {
    if (!(await probeCandidate(candidate, apiKey))) return null
    const base_url = normalizeBaseUrl(candidate.baseUrl)
    const models = await listEndpointModels(candidate.type, base_url, apiKey)
    return { type: candidate.type, base_url, label: candidate.label, models }
  }))

  // Dedupe endpoints that are the same server reached via different hostnames
  // (e.g. host.docker.internal and localhost outside a container): keep the
  // first hit per type + identical model list.
  const seen = new Set<string>()
  const found: DiscoveredEndpoint[] = []
  for (const endpoint of probed) {
    if (!endpoint) continue
    const signature = `${endpoint.type}|${[...endpoint.models].sort().join(',')}`
    if (endpoint.models.length > 0 && seen.has(signature)) continue
    seen.add(signature)
    found.push(endpoint)
  }
  return found
}

async function autodiscoverLocalLlm(host: string, requestedType?: string, apiKey?: string): Promise<LocalLlmResolvedConfig | null> {
  const base = normalizeHostToHttpBase(host)
  if (!base) return null

  const requestedRaw = requestedType?.trim().toLowerCase()
  const requested = !requestedRaw || requestedRaw === 'auto'
    ? 'auto'
    : canonicalLocalLlmType(requestedType)
  if (requested !== 'auto' && requested !== 'ollama' && requested !== 'litellm' && requested !== 'llm' && requested !== 'llamacpp' && requested !== 'vllm' && requested !== 'lmstudio' && requested !== 'llm-proxy') {
    return null
  }

  if (baseHasExplicitPort(base)) {
    const explicitBase = normalizeBaseUrl(base)
    return {
      name: 'local-env',
      type: requested === 'auto' || requested === 'llm' ? inferTypeFromBaseUrl(explicitBase) : requested,
      base_url: explicitBase,
      api_key: apiKey,
      api_key_configured: Boolean(apiKey),
      autodiscovered: true,
    }
  }

  const candidates: DiscoveryCandidate[] = requested === 'ollama'
    ? [{ type: 'ollama', baseUrl: `${base}:11434`, label: 'Ollama' }]
    : requested === 'llamacpp'
      ? [{ type: 'llamacpp', baseUrl: `${base}:8080`, label: 'llama.cpp' }]
      : requested === 'lmstudio'
        ? [{ type: 'lmstudio', baseUrl: `${base}:1234/v1`, label: 'LM Studio' }]
        : requested === 'vllm'
          ? [{ type: 'vllm', baseUrl: `${base}:8000/v1`, label: 'vLLM' }]
          : requested === 'llm-proxy'
            ? [{ type: 'llm-proxy', baseUrl: `${base}:4000/v1`, label: 'LLM proxy' }]
            : requested === 'auto' || requested === 'llm'
              ? allCandidatesFor(base)
              : []

  for (const candidate of candidates) {
    if (await probeCandidate(candidate, apiKey)) {
      return {
        name: 'local-env',
        type: candidate.type,
        base_url: normalizeBaseUrl(candidate.baseUrl),
        api_key: apiKey,
        api_key_configured: Boolean(apiKey),
        autodiscovered: true,
      }
    }
  }

  return {
    name: 'local-env',
    type: requested === 'llm' || requested === 'auto' ? 'litellm' : requested,
    base_url: '',
    api_key: apiKey,
    api_key_configured: Boolean(apiKey),
    autodiscovered: true,
    discovery_error: `Unable to autodiscover a local LLM endpoint on ${host}`,
  }
}

export async function loadLocalLlmConfig(env: NodeJS.ProcessEnv = process.env): Promise<LocalLlmResolvedConfig | null> {
  const enabledFlag = normalizeFlag(env['LOCAL_LLM_ENABLED'])
  const configured = Boolean(
    env['LOCAL_LLM_BASE_URL']?.trim()
    || env['LOCAL_LLM_HOST']?.trim()
    || env['LOCAL_LLM_TYPE']?.trim()
    || env['LOCAL_LLM_MODEL']?.trim()
    || env['LOCAL_LLM_API_KEY']?.trim()
  )

  if (enabledFlag === false || (!configured && enabledFlag !== true)) return null

  const apiKey = env['LOCAL_LLM_API_KEY']?.trim() || undefined
  const model = env['LOCAL_LLM_MODEL']?.trim() || undefined
  const name = env['LOCAL_LLM_NAME']?.trim() || 'local-env'
  const rawBaseUrl = env['LOCAL_LLM_BASE_URL']?.trim()
  const rawHost = env['LOCAL_LLM_HOST']?.trim()

  if (rawBaseUrl) {
    const baseUrl = normalizeBaseUrl(rawBaseUrl)
    return {
      name,
      type: canonicalLocalLlmType(env['LOCAL_LLM_TYPE'], baseUrl),
      base_url: baseUrl,
      model,
      api_key: apiKey,
      api_key_configured: Boolean(apiKey),
    }
  }

  if (rawHost) {
    const discovered = await autodiscoverLocalLlm(rawHost, env['LOCAL_LLM_TYPE'], apiKey)
    if (!discovered) return null
    return {
      ...discovered,
      name,
      model,
    }
  }

  // Enabled but no host/base_url given: probe default hosts. Inside a
  // container, localhost is the container itself — host.docker.internal
  // (mapped via extra_hosts: host-gateway) reaches services on the host.
  if (enabledFlag === true) {
    for (const host of DEFAULT_DISCOVERY_HOSTS) {
      const discovered = await autodiscoverLocalLlm(host, env['LOCAL_LLM_TYPE'], apiKey)
      if (discovered && !discovered.discovery_error) {
        return { ...discovered, name, model }
      }
    }
    return {
      name,
      type: canonicalLocalLlmType(env['LOCAL_LLM_TYPE']),
      base_url: '',
      model,
      api_key: apiKey,
      api_key_configured: Boolean(apiKey),
      autodiscovered: true,
      discovery_error: `Unable to autodiscover a local LLM endpoint (tried ${DEFAULT_DISCOVERY_HOSTS.join(', ')})`,
    }
  }

  return null
}

export function isOpenAiCompatibleProviderType(type: string | undefined): boolean {
  if (!type) return false
  const normalized = canonicalLocalLlmType(type)
  return normalized === 'openai' || normalized === 'codex' || normalized === 'llm' || normalized === 'litellm' || LOCAL_LLM_OPENAI_COMPATIBLE_TYPES.has(normalized)
}

export function shouldUseEnvLocalLlmApiKey(
  candidate: { type?: string | null; base_url?: string | null },
  localConfig: LocalLlmResolvedConfig | null,
): boolean {
  if (!localConfig?.api_key) return false
  const candidateBaseUrl = candidate.base_url ? normalizeBaseUrl(candidate.base_url) : ''
  if (!candidateBaseUrl || candidateBaseUrl !== normalizeBaseUrl(localConfig.base_url)) return false

  const candidateType = canonicalLocalLlmType(candidate.type ?? undefined, candidateBaseUrl)
  const localType = canonicalLocalLlmType(localConfig.type, localConfig.base_url)

  if (candidateType === localType) return true
  return isOpenAiCompatibleProviderType(candidateType) && isOpenAiCompatibleProviderType(localType)
}
