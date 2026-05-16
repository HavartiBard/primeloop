import type { PrimeContext } from './context.js'

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

  const actions = value.actions.map(validatePrimeAction)
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

function validatePrimeAction(value: unknown): PrimeAction {
  if (!isRecord(value)) {
    throw new Error('Prime action must be an object')
  }

  if (typeof value.type !== 'string' || !PRIME_ACTION_TYPES.includes(value.type as PrimeActionType)) {
    throw new Error(`Unsupported Prime action type: ${String(value.type)}`)
  }

  if (!isRecord(value.payload)) {
    throw new Error('Prime action payload must be an object')
  }

  if (typeof value.reason !== 'string' || value.reason.trim() === '') {
    throw new Error('Prime action reason must be a non-empty string')
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

export function buildPrimeSystemPrompt(context: PrimeContext): string {
  const agentLines = context.fleet.agents.map(
    (a) => `- ${a.name} [${(a.capabilities as string[]).join(', ')}]${a.enabled ? '' : ' (disabled)'}`,
  )
  const workLines = context.fleet.workItems.map(
    (w) => `- [${w.id.slice(0, 8)}] ${w.title} (${w.status}/${w.lane})`,
  )
  const delegationLines = context.fleet.delegations.map(
    (d) => `- [${d.id.slice(0, 8)}] ${d.capability} → ${d.to_agent_id ?? 'unassigned'} (${d.status})`,
  )
  const eventLines = context.recentEvents.slice(0, 20).map(
    (e) => `- ${e.event_type} by ${e.actor}`,
  )
  const lessonLines = context.recentLessons.map((l) => `- ${l.content}`)

  return [
    'You are the Prime Agent — the orchestration brain of an autonomous AI agent fleet.',
    'Your job is to survey fleet state and decide the next actions.',
    '',
    '## Fleet Agents',
    '',
    ...agentLines,
    '',
    '## Active Work Items',
    '',
    ...workLines,
    '',
    '## Pending Delegations',
    '',
    ...delegationLines,
    '',
    '## Recent Events',
    '',
    ...eventLines,
    '',
    '## Lessons',
    '',
    ...lessonLines,
    '',
    '## Response Format',
    '',
    'Respond with a JSON object only — no markdown, no code fences:',
    '{',
    '  "reasoning": "<chain of thought, max 500 chars>",',
    '  "actions": [',
    '    { "type": "delegate"|"update_work_item"|"request_approval"|"no_op", "payload": {...}, "reason": "..." }',
    '  ]',
    '}',
    '',
    'For delegate, payload must include:',
    '  title (string), description (string), capability (string),',
    '  allowed_files (string[]), read_files (string[]),',
    '  verification_cmd (string, optional), thread_id (string, optional).',
    '',
    'Prefer no_op if nothing meaningful needs doing right now.',
  ].join('\n')
}

export function buildPrimeTriggerMessage(context: PrimeContext): string {
  return [
    `Trigger: ${context.trigger.type}`,
    JSON.stringify(context.trigger.payload, null, 2),
    '',
    'Survey the fleet and decide your next actions.',
  ].join('\n')
}
