import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type pg from 'pg'
import { getPrimeConfig, type PrimeConfigRoute } from './config.js'
import { getProviderApiKey } from '../registry.js'
import type { PrimeContext } from './context.js'
import { loadPrimeWorkspaceTemplates, renderTemplate } from '../workspace.js'

export const PRIME_ACTION_TYPES = [
  'delegate',
  'update_work_item',
  'request_approval',
  'no_op',
] as const

export type PrimeActionType = typeof PRIME_ACTION_TYPES[number]

export interface PrimeAction {
  type: PrimeActionType
  payload: Record<string, unknown>
  reason: string
}

export interface PrimeDecision {
  reasoning: string
  actions: PrimeAction[]
  token_count?: number
  provider_used?: string
  model_used?: string
}

export interface LlmRouter {
  decide(context: PrimeContext): Promise<PrimeDecision>
}

export function validatePrimeDecision(value: unknown): PrimeDecision {
  if (!isRecord(value)) {
    throw new Error('Prime decision must be an object')
  }

  if (typeof value.reasoning !== 'string' || value.reasoning.trim() === '') {
    throw new Error('Prime decision reasoning must be a non-empty string')
  }

  if (!Array.isArray(value.actions)) {
    throw new Error('Prime decision actions must be an array')
  }

  const actions = value.actions
    .map(validatePrimeActionOrNull)
    .filter((action): action is PrimeAction => action !== null)
  const decision: PrimeDecision = {
    reasoning: value.reasoning,
    actions,
  }

  if ('token_count' in value) {
    if (typeof value.token_count !== 'number' || !Number.isFinite(value.token_count) || value.token_count < 0) {
      throw new Error('Prime decision token_count must be a non-negative number')
    }
    decision.token_count = value.token_count
  }

  if ('provider_used' in value) {
    if (typeof value.provider_used !== 'string' || value.provider_used.trim() === '') {
      throw new Error('Prime decision provider_used must be a non-empty string')
    }
    decision.provider_used = value.provider_used
  }

  if ('model_used' in value) {
    if (typeof value.model_used !== 'string' || value.model_used.trim() === '') {
      throw new Error('Prime decision model_used must be a non-empty string')
    }
    decision.model_used = value.model_used
  }

  return decision
}

export function createMockLlmRouter(decision: unknown): LlmRouter {
  const validated = validatePrimeDecision(decision)
  return {
    async decide(_context: PrimeContext): Promise<PrimeDecision> {
      return validated
    },
  }
}

export function createUnavailableLlmRouter(): LlmRouter {
  return {
    async decide(_context: PrimeContext): Promise<PrimeDecision> {
      throw new Error('Prime LLM router is not configured in Phase A')
    },
  }
}

function validatePrimeActionOrNull(value: unknown): PrimeAction | null {
  if (!isRecord(value)) {
    return null
  }

  if (typeof value.type !== 'string' || !PRIME_ACTION_TYPES.includes(value.type as PrimeActionType)) {
    return null
  }

  if (!isRecord(value.payload)) {
    return null
  }

  if (typeof value.reason !== 'string' || value.reason.trim() === '') {
    return null
  }

  return {
    type: value.type as PrimeActionType,
    payload: value.payload,
    reason: value.reason,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function buildPrimeSystemPrompt(context: PrimeContext, pool: pg.Pool): Promise<string> {
  const { rows } = await pool.query(
    "SELECT persona, operating_policy FROM chief_profiles WHERE id = 'default'"
  )

  const profile = rows[0]
  const templates = await loadPrimeWorkspaceTemplates(pool)

  return renderTemplate(templates.templates.system, {
    prime_profile: templates.templates.primeProfile.trim() || profile?.persona || 'You are Prime.',
    standing_rules: templates.templates.standingRules.trim() || profile?.operating_policy || '',
    agents: formatLines(context.fleet.agents.map(
      (a) => `- ${a.name} [${(a.capabilities as string[]).join(', ')}]${a.enabled ? '' : ' (disabled)'}`,
    )),
    work_items: formatLines(context.fleet.workItems.map(
      (w) => `- [${w.id.slice(0, 8)}] ${w.title} (${w.status}/${w.lane})`,
    )),
    delegations: formatLines(context.fleet.delegations.map(
      (d) => `- [${d.id.slice(0, 8)}] ${d.capability} -> ${d.to_agent_id ?? 'unassigned'} (${d.status})`,
    )),
    recent_events: formatLines(context.recentEvents.slice(0, 20).map(
      (e) => `- ${e.event_type} by ${e.actor}`,
    )),
    thread_messages: formatLines(context.threadMessages.map(
      (m) => `- ${m.sender || m.role}: ${m.content.slice(0, 240)}`,
    )),
    lessons: formatLines(context.recentLessons.map((lesson) => `- ${lesson.content}`)),
  })
}

export async function buildPrimeTriggerMessage(context: PrimeContext, pool: pg.Pool): Promise<string> {
  const templates = await loadPrimeWorkspaceTemplates(pool)
  if (context.trigger.type === 'prime.message') {
    return renderTemplate(templates.templates.request, {
      sender: context.trigger.payload.sender,
      thread_id: context.trigger.payload.thread_id,
      message_id: context.trigger.payload.message_id,
      user_message: context.trigger.payload.content,
    })
  }

  return [
    `Trigger: ${context.trigger.type}`,
    JSON.stringify(context.trigger.payload, null, 2),
    '',
    'Survey the fleet and decide your next actions.',
  ].join('\n')
}

export function createConfiguredLlmRouter(pool: pg.Pool): LlmRouter {
  return {
    async decide(context: PrimeContext): Promise<PrimeDecision> {
      const config = await getPrimeConfig(pool)
      const routes: PrimeConfigRoute[] =
        config.provider_routing?.['planning'] ??
        config.provider_routing?.['routing'] ??
        []

      const resolvedRoutes = routes.length > 0 ? routes : await fallbackProviderRoutes(pool)
      if (resolvedRoutes.length === 0) {
        throw new Error('prime-agent: no provider routes configured in prime_agent_config')
      }

      let lastError: Error = new Error('no providers tried')

      for (const route of resolvedRoutes) {
        try {
          return await callProvider(pool, route, context)
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err))
        }
      }

      throw lastError
    },
  }
}

async function fallbackProviderRoutes(pool: pg.Pool): Promise<PrimeConfigRoute[]> {
  const { rows } = await pool.query<{ id: string; model: string }>(
    `SELECT id, model
     FROM providers
     WHERE type <> 'codex'
       AND model IS NOT NULL
       AND trim(model) <> ''
     ORDER BY created_at
     LIMIT 1`
  )
  const provider = rows[0]
  return provider ? [{ provider_id: provider.id, model: provider.model }] : []
}

async function callProvider(
  pool: pg.Pool,
  route: PrimeConfigRoute,
  context: PrimeContext,
): Promise<PrimeDecision> {
  const { rows } = await pool.query(
    'SELECT type, base_url, model, timeout_ms FROM providers WHERE id = $1',
    [route.provider_id],
  )
  const provider = rows[0]
  if (!provider) throw new Error(`provider not found: ${route.provider_id}`)

  const apiKey = await getProviderApiKey(pool, route.provider_id)
  if (!apiKey && provider.type === 'anthropic') {
    throw new Error(`provider ${route.provider_id} has no API key configured`)
  }

  const systemPrompt = await buildPrimeSystemPrompt(context, pool)
  const userMessage = await buildPrimeTriggerMessage(context, pool)
  const model = route.model
  const timeoutMs = normalizeProviderTimeout(provider.timeout_ms)

  if (provider.type === 'anthropic') {
    return callAnthropic(apiKey ?? '', model, systemPrompt, userMessage, provider.type, timeoutMs)
  }
  if (provider.type === 'llamacpp') {
    return callLlamaCpp(pool, provider.base_url, model, systemPrompt, userMessage, provider.type, timeoutMs)
  }
  return callOpenAI(
    normalizeOpenAiBaseUrl(provider.base_url),
    apiKey ?? 'not-required',
    model,
    systemPrompt,
    userMessage,
    provider.type,
    timeoutMs
  )
}

async function callLlamaCpp(
  pool: pg.Pool,
  baseURL: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  providerType: string,
  timeoutMs: number,
): Promise<PrimeDecision> {
  const templates = await loadPrimeWorkspaceTemplates(pool)
  const response = await fetchWithTimeout(`${baseURL.trim().replace(/\/+$/, '')}/completion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: buildCompactLlamaCppPrompt(templates.templates.llamacpp, systemPrompt, userMessage),
      stream: false,
      n_predict: 128,
      temperature: 0,
      cache_prompt: false,
      reasoning_format: 'none',
      json_schema: {
        type: 'object',
        properties: {
          reasoning: { type: 'string' },
          actions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['delegate', 'update_work_item', 'request_approval', 'no_op'] },
                payload: { type: 'object' },
                reason: { type: 'string' },
              },
              required: ['type', 'payload', 'reason'],
            },
          },
        },
        required: ['reasoning', 'actions'],
      },
    }),
  }, timeoutMs)

  if (!response.ok) {
    throw new Error(`prime-agent: llama.cpp provider returned HTTP ${response.status}`)
  }

  const payload = await response.json() as { content?: string; tokens_evaluated?: number; tokens_predicted?: number; model?: string }
  const decision = validatePrimeDecision(parseJsonDecision(payload.content ?? ''))
  decision.provider_used = providerType
  decision.model_used = payload.model ?? model
  decision.token_count = (payload.tokens_evaluated ?? 0) + (payload.tokens_predicted ?? 0)
  return decision
}

function buildCompactLlamaCppPrompt(template: string, systemPrompt: string, userMessage: string): string {
  return renderTemplate(template, {
    system_prompt: systemPrompt.split('## Response Format')[0]?.slice(0, 2000) ?? '',
    user_message: userMessage.slice(0, 2000),
  })
}

function formatLines(lines: string[]): string {
  return lines.length > 0 ? lines.join('\n') : '- none'
}

function normalizeOpenAiBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed || trimmed === 'https://api.openai.com/v1') return trimmed
  return /\/v1\/?$/.test(trimmed) ? trimmed : `${trimmed.replace(/\/+$/, '')}/v1`
}

async function callAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  providerType: string,
  timeoutMs: number,
): Promise<PrimeDecision> {
  const client = new Anthropic({ apiKey, timeout: timeoutMs })
  const response = await withProviderTimeout(client.messages.create({
    model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  }), timeoutMs)

  const text = response.content.find((b) => b.type === 'text')?.text ?? ''
  const tokenCount = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0)
  const decision = validatePrimeDecision(parseJsonDecision(text))
  decision.provider_used = providerType
  decision.model_used = response.model ?? model
  decision.token_count = tokenCount
  return decision
}

async function callOpenAI(
  baseURL: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  providerType: string,
  timeoutMs: number,
): Promise<PrimeDecision> {
  const client = new OpenAI({ apiKey, baseURL: baseURL || undefined, timeout: timeoutMs })
  const response = await withProviderTimeout(client.chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  }), timeoutMs)

  const text = response.choices[0]?.message?.content ?? ''
  const tokenCount = response.usage?.total_tokens ?? 0
  const decision = validatePrimeDecision(parseJsonDecision(text))
  decision.provider_used = providerType
  decision.model_used = response.model ?? model
  decision.token_count = tokenCount
  return decision
}

async function withProviderTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`prime-agent: provider timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([operation, timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`prime-agent: provider timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function parseJsonDecision(text: string): unknown {
  const trimmed = text.trim()
  const stripped = trimmed.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  try {
    return JSON.parse(stripped)
  } catch {
    const jsonStart = stripped.indexOf('{')
    const jsonEnd = stripped.lastIndexOf('}')
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      try {
        return JSON.parse(stripped.slice(jsonStart, jsonEnd + 1))
      } catch {
        // Fall through to the original diagnostic.
      }
    }
    const partialReasoning = extractPartialStringField(stripped, 'reasoning')
    if (partialReasoning) {
      return {
        reasoning: partialReasoning,
        actions: [],
      }
    }
    throw new Error(`prime-agent: LLM returned non-JSON: ${stripped.slice(0, 200)}`)
  }
}

function normalizeProviderTimeout(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 120000
  return Math.max(5000, Math.min(value, 600000))
}

function extractPartialStringField(text: string, field: string): string | null {
  const pattern = new RegExp(`"${field}"\\s*:\\s*"`)
  const match = pattern.exec(text)
  if (!match) return null

  let value = ''
  let escaping = false
  for (let index = match.index + match[0].length; index < text.length; index += 1) {
    const char = text[index]
    if (escaping) {
      value += char
      escaping = false
      continue
    }
    if (char === '\\') {
      escaping = true
      continue
    }
    if (char === '"') break
    value += char
  }

  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized || null
}
