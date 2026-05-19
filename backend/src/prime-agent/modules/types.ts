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

export interface PrimeLoopModuleRun {
  id: string
  stage: PrimeModuleStage
  version: string
  status: 'completed' | 'failed'
  detail?: string
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
}

export interface PrimeModuleResult {
  detail?: string
}

export interface PrimeModule {
  id: string
  stage: PrimeModuleStage
  version: string
  order: number
  run(state: PrimeLoopState, deps: PrimeModuleDeps): Promise<PrimeModuleResult | void>
}
