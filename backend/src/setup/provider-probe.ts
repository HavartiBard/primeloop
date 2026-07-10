/**
 * Live provider validation for setup: proves a provider/model pair actually
 * works before setup completes, instead of failing silently at runtime.
 *
 * Two checks:
 *  - completion: a trivial chat completion round-trip
 *  - tool_call: the model must answer a forced tool call — Prime and the
 *    fleet depend on reliable tool calling, and many small local models
 *    accept the request but never emit a tool call.
 */

export interface ProviderProbeTarget {
  type: string
  base_url?: string | null
  api_key?: string | null
  model: string
}

export interface ProviderProbeResult {
  completion_ok: boolean
  tool_call_ok: boolean
  latency_ms: number
  error?: string
  /** Set when a local model fails the tool-call check. */
  hint?: string
}

// Generous: a local server cold-loading a large model can take well over a
// minute on first request, and setup is a one-time flow.
const PROBE_TIMEOUT_MS = 120_000

// Local models known to handle tool calls reliably at ≥7B — surfaced when a
// local provider fails the tool-call probe.
const RECOMMENDED_LOCAL_MODELS = 'qwen2.5-coder:14b, qwen2.5:14b, llama3.1:70b, mistral-small-3'

const PROBE_TOOL = {
  name: 'report_status',
  description: 'Report a status word back to the system.',
  parameters: {
    type: 'object',
    properties: { status: { type: 'string', description: 'The status word, e.g. "ok"' } },
    required: ['status'],
  },
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeOpenAiBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return 'https://api.openai.com/v1'
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`
}

function isLocalProviderType(type: string): boolean {
  return type !== 'anthropic' && type !== 'openai' && type !== 'codex'
}

async function readError(response: Response): Promise<string> {
  const body = (await response.text().catch(() => '')).slice(0, 300)
  return `HTTP ${response.status}${body ? `: ${body}` : ''}`
}

// ─── Anthropic ────────────────────────────────────────────────────────────────

async function probeAnthropic(target: ProviderProbeTarget): Promise<Omit<ProviderProbeResult, 'latency_ms'>> {
  const baseUrl = (target.base_url?.trim().replace(/\/+$/, '') || 'https://api.anthropic.com')
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': target.api_key ?? '',
    'anthropic-version': '2023-06-01',
  }

  const completionResponse = await fetchWithTimeout(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: target.model,
      max_tokens: 32,
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
    }),
  })
  if (!completionResponse.ok) {
    return { completion_ok: false, tool_call_ok: false, error: await readError(completionResponse) }
  }

  const toolResponse = await fetchWithTimeout(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: target.model,
      max_tokens: 256,
      tools: [{
        name: PROBE_TOOL.name,
        description: PROBE_TOOL.description,
        input_schema: PROBE_TOOL.parameters,
      }],
      tool_choice: { type: 'tool', name: PROBE_TOOL.name },
      messages: [{ role: 'user', content: 'Report status ok.' }],
    }),
  })
  if (!toolResponse.ok) {
    return { completion_ok: true, tool_call_ok: false, error: await readError(toolResponse) }
  }
  const toolData = await toolResponse.json() as { content?: Array<{ type?: string }> }
  const toolCallOk = Boolean(toolData.content?.some((block) => block.type === 'tool_use'))
  return { completion_ok: true, tool_call_ok: toolCallOk }
}

// ─── OpenAI-compatible (openai, ollama /v1, lmstudio, vllm, litellm, …) ───────

async function probeOpenAiCompatible(target: ProviderProbeTarget): Promise<Omit<ProviderProbeResult, 'latency_ms'>> {
  const baseUrl = normalizeOpenAiBaseUrl(target.base_url ?? '')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (target.api_key) headers['Authorization'] = `Bearer ${target.api_key}`

  const completionResponse = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: target.model,
      max_tokens: 32,
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
    }),
  })
  if (!completionResponse.ok) {
    return { completion_ok: false, tool_call_ok: false, error: await readError(completionResponse) }
  }

  const toolResponse = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: target.model,
      max_tokens: 256,
      tools: [{ type: 'function', function: PROBE_TOOL }],
      tool_choice: 'auto',
      messages: [{ role: 'user', content: 'Use the report_status tool to report status ok.' }],
    }),
  })
  if (!toolResponse.ok) {
    return { completion_ok: true, tool_call_ok: false, error: await readError(toolResponse) }
  }
  const toolData = await toolResponse.json() as {
    choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name?: string } }> } }>
  }
  const toolCalls = toolData.choices?.[0]?.message?.tool_calls
  return { completion_ok: true, tool_call_ok: Boolean(toolCalls && toolCalls.length > 0) }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function probeProvider(target: ProviderProbeTarget): Promise<ProviderProbeResult> {
  const startedAt = Date.now()
  try {
    const result = target.type === 'anthropic'
      ? await probeAnthropic(target)
      : await probeOpenAiCompatible(target)

    const probeResult: ProviderProbeResult = { ...result, latency_ms: Date.now() - startedAt }
    if (!probeResult.tool_call_ok && probeResult.completion_ok && isLocalProviderType(target.type)) {
      probeResult.hint = `Model "${target.model}" responded but did not produce a tool call — PrimeLoop needs reliable tool calling. Try a larger model, e.g.: ${RECOMMENDED_LOCAL_MODELS}`
    }
    return probeResult
  } catch (err) {
    const message = err instanceof Error
      ? (err.name === 'AbortError'
        ? `timed out after ${PROBE_TIMEOUT_MS / 1000}s — if this is a local server, the model may still be loading; try again once it responds`
        : err.message)
      : String(err)
    return {
      completion_ok: false,
      tool_call_ok: false,
      latency_ms: Date.now() - startedAt,
      error: message,
    }
  }
}
