import type pg from 'pg'
import type { PrimeActionDispatchResult } from '../actions.js'
import type { PrimeContext } from '../context.js'
import type { PrimeEvent } from '../events.js'
import type { LlmRouter, PrimeDecision } from '../llm-router.js'
import type { PrimeSession } from '../session.js'

export const PRIME_MODULE_STAGES = [
  'trigger',
  'debounce',
  'context',
  'decision',
  'policy',
  'action',
  'feedback',
  'learning',
  'observer',
] as const

export type PrimeModuleStage = typeof PRIME_MODULE_STAGES[number]

export const PRIME_MODULE_ROLLOUT_MODES = [
  'active',
  'shadow',
] as const

export type PrimeModuleRolloutMode = typeof PRIME_MODULE_ROLLOUT_MODES[number]

export interface PrimeLoopModuleRun {
  id: string
  stage: PrimeModuleStage
  version: string
  mode: PrimeModuleRolloutMode
  status: 'completed' | 'failed'
  detail?: string
  started_at: string
  completed_at: string
}

export interface PrimeLoopState {
  event: PrimeEvent
  session: PrimeSession
  context?: PrimeContext
  decision?: PrimeDecision
  actions: PrimeActionDispatchResult[]
  diagnostics: string[]
  moduleRuns: PrimeLoopModuleRun[]
  budget: {
    llmCalls: number
    actionsDispatched: number
  }
}

export interface PrimeModuleDeps {
  pool: pg.Pool
  router: LlmRouter
  sessionId: string
  executionMode: PrimeModuleRolloutMode
  moduleConfig: Record<string, unknown>
}

export interface PrimeModuleResult {
  detail?: string
}

export interface PrimeModule {
  id: string
  stage: PrimeModuleStage
  version: string
  available_versions?: string[]
  order: number
  requires_active?: boolean
  run(state: PrimeLoopState, deps: PrimeModuleDeps): Promise<PrimeModuleResult | void>
}

export interface PrimeModuleConfig {
  module_id: string
  stage: PrimeModuleStage
  default_version: string
  pinned_version?: string
  enabled: boolean
  rollout_mode: PrimeModuleRolloutMode
  config: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface PrimeModuleConfigPatch {
  pinned_version?: string | null
  enabled?: boolean
  rollout_mode?: PrimeModuleRolloutMode
  config?: Record<string, unknown>
}

export interface PrimeConfiguredModule {
  module: PrimeModule
  rollout_mode: PrimeModuleRolloutMode
  config: Record<string, unknown>
}

export interface PrimeModuleConfigAudit {
  id: string
  module_id: string
  actor: string
  changed_fields: string[]
  previous_config: Record<string, unknown>
  next_config: Record<string, unknown>
  created_at: string
}
