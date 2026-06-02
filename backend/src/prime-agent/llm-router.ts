import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type pg from 'pg'
import { getPrimeConfig, resolveModelRoutes, type PrimeConfigRoute } from './config.js'
import { getProviderApiKey } from '../registry.js'
import type { PrimeContext } from './context.js'
import type { Domain } from '../goals/types.js'
import type { RuntimeTruth } from '../routing/index.js'
import { loadPrimeWorkspaceTemplates, renderTemplate } from '../workspace.js'

export const PRIME_ACTION_TYPES = [
  'delegate',
  'update_work_item',
  'request_approval',
  'update_profile',
  'no_op',
] as const

export type PrimeActionType = typeof PRIME_ACTION_TYPES[number]

// ─── Delegation Decision Types (FR-003, FR-004, FR-005) ──────────

/** Structured delegation action produced by Prime's decision logic. */
export interface DelegateAction {
  type: 'delegate';
  assignedAgentRole: string;  // e.g., 'SRE/DevOps', 'Architect'
  domain: Domain;
  title: string;
  scope: string;
  dependsOn?: string[];
}

/** LLM payload shape accepted for delegate actions. */
export interface DelegateActionPayload {
  assigned_agent_role?: string;
  assignedAgentRole?: string;
  domain?: Domain;
  title?: string;
  scope?: string;
  depends_on?: string[];
  dependsOn?: string[];
}

/** Maps each goal domain to the canonical agent role name (from agent_roles table). */
const DOMAIN_ROLE_MAP: Record<Domain, string> = {
  homelab: 'SRE/DevOps',
  development: 'Architect',
  personal_assistant: 'personal_assistant',
  cross_domain: 'prime',
};

/** Keywords used to classify goal intent text into domains. */
const DOMAIN_KEYWORDS: Record<Domain, string[]> = {
  homelab: [
    'server', 'deploy', 'infrastructure', 'network', 'docker', 'container',
    'monitoring', 'backup', 'dns', 'ssl', 'certificate', 'firewall',
    'nas', 'storage', 'vm', 'virtual', 'provisioning', 'homelab',
    'hardware', 'raid', 'nfs', 'smb', 'ssh', 'cron', 'service',
    'restart', 'update system', 'package', 'apt', 'yum', 'systemd',
    'nginx', 'apache', 'reverse proxy', 'port', 'vlan', 'switch',
  ],
  development: [
    'code', 'refactor', 'test', 'api', 'endpoint', 'database', 'schema',
    'migration', 'library', 'package', 'frontend', 'backend', 'sdk',
    'typescript', 'python', 'javascript', 'react', 'component', 'function',
    'bug', 'fix', 'feature', 'implement', 'review', 'architect',
    'design', 'pattern', 'module', 'class', 'interface', 'type',
    'repository', 'git', 'branch', 'merge', 'ci/cd', 'pipeline',
  ],
  personal_assistant: [
    'schedule', 'reminder', 'email', 'calendar', 'organize', 'summarize',
    'research', 'search', 'write', 'draft', 'plan trip', 'recipe',
    'translate', 'list', 'compare', 'recommend', 'personal',
  ],
  cross_domain: [
    'all', 'every', 'entire', 'full', 'comprehensive', 'everything',
  ],
};

/**
 * Assess goal intent text and determine which domains are involved.
 * Returns domains sorted by relevance score (highest first).
 */
export function assessGoalDomains(intent: string): Domain[] {
  const lower = intent.toLowerCase()
  const scores: Array<{ domain: Domain; score: number }> = []

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    let score = 0
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        score += 1
      }
    }
    if (score > 0) {
      scores.push({ domain: domain as Domain, score })
    }
  }

  // cross_domain only wins if no other domain scored at all
  const nonCrossScores = scores.filter((s) => s.domain !== 'cross_domain')
  if (nonCrossScores.length > 0) {
    return nonCrossScores
      .sort((a, b) => b.score - a.score)
      .map((s) => s.domain)
  }

  // Fall back to cross_domain if nothing else matched
  if (scores.some((s) => s.domain === 'cross_domain')) {
    return ['cross_domain']
  }

  // Default: treat unmatched intent as personal_assistant
  return ['personal_assistant']
}

/** Resolve the canonical specialist role for a domain. */
export function resolveAgentRoleForDomain(domain: Domain): string {
  return DOMAIN_ROLE_MAP[domain]
}

/**
 * Resolve delegation targets from goal intent and explicit domains.
 * Produces structured DelegateAction[] for each relevant domain.
 *
 * @param intent - The goal's natural-language intent description
 * @param explicitDomains - Optionally override auto-detected domains
 * @param title - Goal title used to frame each delegate action's title
 */
export function resolveDelegation(
  intent: string,
  explicitDomains?: Domain[],
  title?: string,
): DelegateAction[] {
  const domains = explicitDomains && explicitDomains.length > 0
    ? explicitDomains
    : assessGoalDomains(intent)

  return domains.map((domain) => {
    const role = resolveAgentRoleForDomain(domain)
    const domainLabel = domain.replace(/_/g, ' ')
    const goalTitle = title || intent.slice(0, 80)

    return {
      type: 'delegate' as const,
      assignedAgentRole: role,
      domain,
      title: `[${domainLabel}] ${goalTitle}`,
      scope: intent,
    }
  })
}

/**
 * Validate that a delegation target role exists in the agent_roles table.
 * Returns true if the role is found, false otherwise.
 */
export async function validateDelegationTarget(
  assignedAgentRole: string,
  pool: pg.Pool,
): Promise<boolean> {
  const { rows } = await pool.query(
    'SELECT id FROM agent_roles WHERE name = $1 OR id = $1',
    [assignedAgentRole],
  )
  return rows.length > 0
}

/**
 * Parse delegate action payload from LLM output into ACP's structured action shape.
 * Supports both snake_case and camelCase field names.
 */
export function parseDelegateActionPayload(
  payload: Record<string, unknown>,
  fallbackReason: string,
): DelegateAction {
  const raw = payload as DelegateActionPayload
  const domain = (raw.domain ?? assessGoalDomains(fallbackReason)[0]) as Domain
  const assignedAgentRole = raw.assigned_agent_role
    ?? raw.assignedAgentRole
    ?? resolveAgentRoleForDomain(domain)
  const title = (raw.title ?? fallbackReason.slice(0, 96)).trim()
  const scope = (raw.scope ?? fallbackReason).trim()

  return {
    type: 'delegate',
    assignedAgentRole,
    domain,
    title,
    scope,
    dependsOn: raw.depends_on ?? raw.dependsOn,
  }
}

export interface PrimeAction {
  type: PrimeActionType
  payload: Record<string, unknown>
  reason: string
}

export interface PrimeDecision {
  reasoning: string
  response?: string
  actions: PrimeAction[]
  token_count?: number
  provider_used?: string
  model_used?: string
}

export interface LlmRouter {
  decide(context: PrimeContext, signal?: AbortSignal): Promise<PrimeDecision>
}

export function validatePrimeDecision(value: unknown, options?: { isUserFacing?: boolean }): PrimeDecision {
  if (!isRecord(value)) {
    throw new Error('Prime decision must be an object')
  }

  const normalized = normalizePrimeDecisionTextFields(value)

  if (typeof normalized.reasoning !== 'string' || normalized.reasoning.trim() === '') {
    throw new Error('Prime decision reasoning must be a non-empty string')
  }

  if (!Array.isArray(value.actions)) {
    throw new Error('Prime decision actions must be an array')
  }

  const isUserFacing = options?.isUserFacing === true

  // Parse actions first so we can check if this is a conversational response.
  const rawActions = Array.isArray(value.actions)
    ? value.actions.map(validatePrimeActionOrNull).filter((a): a is PrimeAction => a !== null)
    : []
  const hasSubstantiveActions = rawActions.some((action) => action.type !== 'no_op')

  // For user-facing events (prime.message), response must be present and meaningful.
  // Conversational responses (no substantive actions) can be short — "Hi!", "Got it",
  // "Thanks" are valid. Action-bearing decisions need longer responses to explain what's happening.
  if (isUserFacing) {
    const responseText = normalized.response ?? ''
    const minLen = hasSubstantiveActions ? 10 : 1
    if (responseText.length < minLen) {
      throw new Error(
        `Prime decision response must be at least ${minLen} character${minLen === 1 ? '' : 's'} for user-facing messages (got ${responseText.length})`
      )
    }
    // Reject responses that contain internal schema labels
    if (/\b(?:reasoning|response|actions):/.test(responseText)) {
      throw new Error('Prime decision response must not contain internal schema labels')
    }
  }

  const actions = rawActions
  const decision: PrimeDecision = {
    reasoning: normalized.reasoning,
    actions,
  }

  if (normalized.response) {
    decision.response = normalized.response
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

function normalizePrimeDecisionTextFields(value: Record<string, unknown>): {
  reasoning: string
  response?: string
} {
  const explicitReasoning = typeof value.reasoning === 'string' ? value.reasoning.trim() : ''
  const explicitResponse = typeof value.response === 'string' ? value.response.trim() : ''

  if (explicitResponse) {
    return {
      reasoning: explicitReasoning,
      response: explicitResponse,
    }
  }

  // If the LLM mislabeled fields, try to recover them from labeled text in reasoning.
  // This is a convenience path only — reasoning is never used as a fallback response.
  const labeled = parseLabeledReasoningAndResponse(explicitReasoning)
  if (labeled) {
    return labeled
  }

  // No response field provided — use reasoning as the fallback for user-facing events.
  // This covers cases where the LLM returns only { reasoning, actions } without a response.
  return {
    reasoning: explicitReasoning,
    response: explicitReasoning || undefined,
  }
}

function parseLabeledReasoningAndResponse(text: string): {
  reasoning: string
  response?: string
} | null {
  if (!text) return null

  const reasoningMatch = text.match(/(?:^|\n)\s*reasoning:\s*([\s\S]*?)(?=(?:\n\s*response:)|$)/i)
  const responseMatch = text.match(/(?:^|\n)\s*response:\s*([\s\S]*?)$/i)

  if (!reasoningMatch && !responseMatch) {
    return null
  }

  const prelude = text
    .replace(/(?:^|\n)\s*reasoning:\s*[\s\S]*?(?=(?:\n\s*response:)|$)/i, '')
    .replace(/(?:^|\n)\s*response:\s*[\s\S]*$/i, '')
    .trim()
  const reasoning = (reasoningMatch?.[1] ?? prelude).trim() || prelude || text
  const response = responseMatch?.[1]?.trim() || prelude || undefined

  return {
    reasoning,
    ...(response ? { response } : {}),
  }
}

export async function buildPrimeSystemPrompt(context: PrimeContext, pool: pg.Pool): Promise<string> {
  const { rows } = await pool.query(
    "SELECT persona, operating_policy FROM chief_profiles WHERE id = 'default'"
  )

  const profile = rows[0]
  const templates = await loadPrimeWorkspaceTemplates(pool)

  const { rows: pendingApprovals } = await pool.query(
    `SELECT id AS approval_id, COALESCE(action_summary, action) AS action, created_at::text
     FROM approvals
     WHERE status = 'pending'
     ORDER BY created_at DESC
     LIMIT 20`
  )

  return renderTemplate(templates.templates.system, {
    prime_soul: templates.templates.primeSoul.trim(),
    prime_profile: templates.templates.primeProfile.trim() || profile?.persona || 'You are Prime.',
    standing_rules: templates.templates.standingRules.trim() || profile?.operating_policy || '',
    agents: context.fleet.agents.length > 0
      ? formatLines(context.fleet.agents.map(
        (a) => {
          const runtime = context.runtimeTruth?.allRuntimeAvailability.find((r) => r.agentId === a.id)
          const capacity = runtime?.capacity ?? 'registered'
          const statusLabel = capacity === 'dispatchable' ? '' : ` [${capacity}]`
          return `- ${a.name} [${(a.capabilities as string[]).join(', ')}]${a.enabled ? '' : ' (disabled)'}${statusLabel}`
        },
      ))
      : '(no agents available — respond directly to the user)',
    runtime_truth: context.runtimeTruth ? buildRuntimeTruthSummary(context.runtimeTruth) : '(runtime truth not available)',
    work_items: formatLines(context.fleet.workItems.map(
      (w) => `- id=${w.id} ${w.title} (${w.status}/${w.lane})`,
    )),
    pending_approvals: pendingApprovals.length > 0
      ? formatLines(pendingApprovals.map((a: { approval_id: string; action: string; created_at: string }) =>
        `- [${a.approval_id}] ${a.action} (since ${a.created_at})`,
      ))
      : '(none)',
    delegations: formatLines(context.fleet.delegations.map(
      (d) => `- id=${d.id} ${d.capability} -> ${d.to_agent_id ?? 'unassigned'} (${d.status})`,
    )),
    recent_events: formatLines(context.recentEvents.slice(0, 20).map(
      (e) => `- ${e.event_type} by ${e.actor}`,
    )),
    thread_messages: formatConversationTranscript(context.threadMessages),
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
    async decide(context: PrimeContext, signal?: AbortSignal): Promise<PrimeDecision> {
      const config = await getPrimeConfig(pool)

      // Use model_preferences (with auto-migration from legacy provider_routing)
      let resolvedRoutes = resolveModelRoutes(config, 'planning')

      // Ultimate fallback: grab first non-codex provider from DB
      if (resolvedRoutes.length === 0) {
        resolvedRoutes = await fallbackProviderRoutes(pool)
      }
      if (resolvedRoutes.length === 0) {
        throw new Error('prime-agent: no provider routes configured in prime_agent_config')
      }

      let lastError: Error = new Error('no providers tried')

      for (const route of resolvedRoutes) {
        if (signal?.aborted) throw new Error('Session aborted by operator')
        try {
          return await callProvider(pool, route, context, signal)
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
  signal?: AbortSignal,
): Promise<PrimeDecision> {
  const { rows } = await pool.query(
    'SELECT type, base_url, model, timeout_ms FROM providers WHERE id = $1',
    [route.provider_id],
  )
  const provider = rows[0]
  if (!provider) throw new Error(`provider not found: ${route.provider_id}`)

  const apiKey = await getProviderApiKey(pool, route.provider_id)
  if (!apiKey && (provider.type === 'anthropic' || provider.type === 'openai')) {
    throw new Error(`provider ${route.provider_id} has no API key configured`)
  }

  const openAiCompatibleApiKey = apiKey ?? (provider.type === 'openai' ? null : 'not-required')

  const systemPrompt = await buildPrimeSystemPrompt(context, pool)
  const userMessage = await buildPrimeTriggerMessage(context, pool)
  const model = route.model
  const timeoutMs = normalizeProviderTimeout(provider.timeout_ms)
  const isUserFacing = context.trigger.type === 'prime.message'

  // Attach provider/model to any error thrown (e.g. timeout) so the
  // failure session record can surface which endpoint was being attempted.
  const baseUrl = provider.base_url ?? ''
  const providerHint = baseUrl ? `${provider.type} (${baseUrl})` : provider.type

  function tagError(err: unknown): never {
    const message = err instanceof Error ? err.message : String(err)
    const tagged = new Error(`[${providerHint}, model: ${model}] ${message}`)
    if (err instanceof Error) tagged.stack = err.stack
    throw tagged
  }

  if (provider.type === 'anthropic') {
    const decision = await callAnthropic(apiKey ?? '', model, systemPrompt, userMessage, provider.type, timeoutMs, isUserFacing, signal).catch(tagError)
    if (!decision.provider_used) decision.provider_used = provider.type
    if (!decision.model_used) decision.model_used = model
    return decision
  }
  if (provider.type === 'llamacpp') {
    const decision = await callLlamaCpp(pool, provider.base_url, model, systemPrompt, userMessage, provider.type, timeoutMs, isUserFacing, signal).catch(tagError)
    if (!decision.provider_used) decision.provider_used = providerHint
    if (!decision.model_used) decision.model_used = model
    return decision
  }
  const decision = await callOpenAI(
    normalizeOpenAiBaseUrl(provider.base_url),
    openAiCompatibleApiKey,
    model,
    systemPrompt,
    userMessage,
    provider.type,
    timeoutMs,
    isUserFacing,
    signal,
  ).catch(tagError)
  if (!decision.provider_used) decision.provider_used = providerHint
  if (!decision.model_used) decision.model_used = model
  return decision
}

async function callLlamaCpp(
  pool: pg.Pool,
  baseURL: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  providerType: string,
  timeoutMs: number,
  isUserFacing: boolean,
  signal?: AbortSignal,
): Promise<PrimeDecision> {
  const templates = await loadPrimeWorkspaceTemplates(pool)
  const response = await fetchWithTimeout(`${baseURL.trim().replace(/\/+$/, '')}/completion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    externalSignal: signal,
    body: JSON.stringify({
      model,
      prompt: buildCompactLlamaCppPrompt(templates.templates.llamacpp, systemPrompt, userMessage),
      stream: false,
      n_predict: 4096,
      temperature: 0,
      cache_prompt: false,
      reasoning_format: 'none',
      json_schema: {
        type: 'object',
        properties: {
          reasoning: { type: 'string' },
          response: { type: 'string' },
          actions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['delegate', 'update_work_item', 'request_approval', 'update_profile', 'no_op'] },
                payload: { type: 'object' },
                reason: { type: 'string' },
              },
              required: ['type', 'payload', 'reason'],
            },
          },
        },
        required: ['reasoning', 'response', 'actions'],
      },
    }),
  }, timeoutMs)

  if (!response.ok) {
    throw new Error(`prime-agent: llama.cpp provider returned HTTP ${response.status}`)
  }

  const payload = await response.json() as { content?: string; tokens_evaluated?: number; tokens_predicted?: number; model?: string }
  const decision = validatePrimeDecision(parseJsonDecision(payload.content ?? ''), { isUserFacing })
  decision.provider_used = providerType
  decision.model_used = payload.model ?? model
  decision.token_count = (payload.tokens_evaluated ?? 0) + (payload.tokens_predicted ?? 0)
  return decision
}

function buildCompactLlamaCppPrompt(template: string, systemPrompt: string, userMessage: string): string {
  // Truncate at section boundaries to avoid cutting mid-instruction.
  // Keep the Response Format section intact as it's critical for JSON output.
  const responseFormatIndex = systemPrompt.indexOf('## Response Format')
  let condensedSystem: string
  if (responseFormatIndex >= 0) {
    const beforeFormat = systemPrompt.slice(0, responseFormatIndex)
    const responseFormat = systemPrompt.slice(responseFormatIndex)
    // Truncate the context section but keep Response Format complete
    const truncatedContext = beforeFormat.length > 1500 ? beforeFormat.slice(0, 1500) : beforeFormat
    condensedSystem = truncatedContext + responseFormat
  } else {
    // No known section boundary — truncate at a paragraph break if possible
    const truncated = systemPrompt.slice(0, 2000)
    const lastParagraphBreak = truncated.lastIndexOf('\n\n')
    condensedSystem = lastParagraphBreak > 500 ? truncated.slice(0, lastParagraphBreak) : truncated
  }
  return renderTemplate(template, {
    system_prompt: condensedSystem,
    user_message: userMessage.slice(0, 3000),
  })
}

function formatLines(lines: string[]): string {
  return lines.length > 0 ? lines.join('\n') : '- none'
}

function formatConversationTranscript(messages: { sender?: string; role: string; content: string }[]): string {
  if (messages.length === 0) return 'No prior conversation.'
  return messages.map((m, i) => {
    const speaker = m.sender || m.role
    const label = speaker.toLowerCase() === 'assistant' ? 'Prime' : speaker
    const content = m.content.length > 300 ? truncateAtBoundary(m.content, 300) : m.content
    return `[${i + 1}] ${label}: ${content}`
  }).join('\n')
}

/** Truncate text at a sentence or paragraph boundary to avoid cutting mid-thought. */
function truncateAtBoundary(text: string, maxLen: number): string {
  const truncated = text.slice(0, maxLen)
  // Try paragraph break first (best boundary)
  const lastParagraphBreak = truncated.lastIndexOf('\n\n')
  if (lastParagraphBreak > maxLen * 0.4) {
    return truncated.slice(0, lastParagraphBreak).trim() + '...'
  }
  // Try sentence boundary (. ! ? followed by space)
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf('. '),
    truncated.lastIndexOf('! '),
    truncated.lastIndexOf('? ')
  )
  if (lastSentenceEnd > maxLen * 0.4) {
    return truncated.slice(0, lastSentenceEnd + 1).trim() + '...'
  }
  // Fallback: hard cut at word boundary
  const lastSpace = truncated.lastIndexOf(' ')
  if (lastSpace > maxLen * 0.4) {
    return truncated.slice(0, lastSpace).trim() + '...'
  }
  // Last resort: hard cut
  return truncated.trim() + '...'
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
  isUserFacing: boolean,
  signal?: AbortSignal,
): Promise<PrimeDecision> {
  const client = new Anthropic({ apiKey, timeout: timeoutMs })
  const response = await withProviderTimeout(client.messages.create({
    model,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  }, { signal }), timeoutMs)

  const text = response.content.find((b) => b.type === 'text')?.text ?? ''
  const tokenCount = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0)
  const decision = validatePrimeDecision(parseJsonDecision(text), { isUserFacing })
  decision.provider_used = providerType
  decision.model_used = response.model ?? model
  decision.token_count = tokenCount
  return decision
}

async function callOpenAI(
  baseURL: string,
  apiKey: string | null,
  model: string,
  systemPrompt: string,
  userMessage: string,
  providerType: string,
  timeoutMs: number,
  isUserFacing: boolean,
  signal?: AbortSignal,
): Promise<PrimeDecision> {
  const client = new OpenAI({ apiKey: apiKey ?? undefined, baseURL: baseURL || undefined, timeout: timeoutMs })
  const response = await withProviderTimeout(client.chat.completions.create({
    model,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'prime_decision',
        schema: {
          type: 'object',
          properties: {
            reasoning: { type: 'string' },
            response: { type: 'string' },
            actions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['delegate', 'update_work_item', 'request_approval', 'update_profile', 'no_op'] },
                  payload: { type: 'object' },
                  reason: { type: 'string' },
                },
                required: ['type', 'payload', 'reason'],
              },
            },
          },
          required: ['reasoning', 'response', 'actions'],
        },
      },
    },
    max_tokens: 8192,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  }, { signal }), timeoutMs)

  const msg = response.choices[0]?.message as unknown as Record<string, unknown>
  // Thinking models (e.g. Qwen3-MTP) put chain-of-thought in reasoning_content
  // and the actual answer in content. If content is empty, fall back to
  // reasoning_content so we can at least surface a parse error rather than
  // silently failing with an empty string.
  const text = (msg?.['content'] as string | undefined)?.trim()
    || (msg?.['reasoning_content'] as string | undefined)?.trim()
    || ''
  const tokenCount = response.usage?.total_tokens ?? 0
  const decision = validatePrimeDecision(parseJsonDecision(text), { isUserFacing })
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

async function fetchWithTimeout(url: string, init: RequestInit & { externalSignal?: AbortSignal }, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  // Also abort if the external session signal fires (operator kill)
  const { externalSignal, ...fetchInit } = init
  externalSignal?.addEventListener('abort', () => controller.abort())

  try {
    return await fetch(url, {
      ...fetchInit,
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      if (externalSignal?.aborted) throw new Error('Session aborted by operator')
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

/**
 * Build a summary of runtime truth for inclusion in Prime system prompt.
 * Shows which agents are dispatchable vs merely registered, and what can be spawned.
 */
function buildRuntimeTruthSummary(runtimeTruth: RuntimeTruth): string {
  const parts: string[] = []

  // Dispatchable agents
  if (runtimeTruth.dispatchableAgents.length > 0) {
    parts.push(
      `Dispatchable agents (can accept work now): ${runtimeTruth.dispatchableAgents.map(({ agent }) => agent.name).join(', ')}`,
    )
  }

  // Registered-only agents
  if (runtimeTruth.registeredOnlyAgents.length > 0) {
    const registeredSummary = runtimeTruth.registeredOnlyAgents
      .map(({ agent, runtime }) => `${agent.name} (${runtime.unavailableReason ?? 'no active harness'})`)
      .join('; ')
    parts.push(`Registered but not dispatchable: ${registeredSummary}`)
  }

  // Spawnable templates
  if (runtimeTruth.spawnableTemplates.length > 0) {
    const spawnableSummary = runtimeTruth.spawnableTemplates
      .map((t) => `${t.template.name} (role: ${t.template.role})`)
      .join('; ')
    parts.push(`Spawnable templates: ${spawnableSummary}`)
  }

  // Capability gaps
  if (runtimeTruth.capabilityGaps.length > 0) {
    parts.push(`Capability gaps (no fulfillment path): ${runtimeTruth.capabilityGaps.join(', ')}`)
  }

  return parts.length > 0 ? parts.join('. ') : 'No runtime truth available.'
}
