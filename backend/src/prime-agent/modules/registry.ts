import { dispatchPrimeActions } from '../actions.js'
import { assemblePrimeContext } from '../context.js'
import { validatePrimeDecision } from '../llm-router.js'
import type { PrimeModule, PrimeModuleDeps, PrimeLoopState } from './types.js'

const CONTEXT_MODULE: PrimeModule = {
  id: 'context.fleet-state',
  stage: 'context',
  version: '1.0.0',
  order: 100,
  async run(state: PrimeLoopState, deps: PrimeModuleDeps) {
    state.context = await assemblePrimeContext(deps.pool, state.event)
    return { detail: `assembled ${state.context.fleet.agents.length} agents` }
  },
}

const DECISION_MODULE: PrimeModule = {
  id: 'decision.llm-router',
  stage: 'decision',
  version: '1.0.0',
  order: 200,
  async run(state: PrimeLoopState, deps: PrimeModuleDeps) {
    if (!state.context) {
      throw new Error('Prime decision module requires context')
    }
    state.decision = validatePrimeDecision(await deps.router.decide(state.context))
    state.budget.llmCalls += 1
    return { detail: `${state.decision.actions.length} actions proposed` }
  },
}

const ACTION_MODULE: PrimeModule = {
  id: 'action.dispatch',
  stage: 'action',
  version: '1.0.0',
  order: 300,
  async run(state: PrimeLoopState, deps: PrimeModuleDeps) {
    if (!state.context || !state.decision) {
      throw new Error('Prime action module requires context and decision')
    }
    state.actions = await dispatchPrimeActions(deps.pool, state.context, state.decision)
    state.budget.actionsDispatched = state.actions.length
    return { detail: `${state.actions.length} actions dispatched` }
  },
}

const STATIC_PRIME_MODULES: PrimeModule[] = [
  CONTEXT_MODULE,
  DECISION_MODULE,
  ACTION_MODULE,
]

export function listPrimeModules(): PrimeModule[] {
  return [...STATIC_PRIME_MODULES].sort(comparePrimeModules)
}

export function summarizePrimeModules(modules: PrimeModule[]): string {
  return modules
    .map((module) => `${module.stage}:${module.id}@${module.version}`)
    .join(', ')
}

export async function runPrimeModules(
  state: PrimeLoopState,
  deps: PrimeModuleDeps,
  modules = listPrimeModules(),
): Promise<void> {
  for (const module of modules) {
    try {
      const result = await module.run(state, deps)
      state.moduleRuns.push({
        id: module.id,
        stage: module.stage,
        version: module.version,
        status: 'completed',
        detail: result?.detail,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      state.moduleRuns.push({
        id: module.id,
        stage: module.stage,
        version: module.version,
        status: 'failed',
        detail: message,
      })
      throw error
    }
  }
}

function comparePrimeModules(left: PrimeModule, right: PrimeModule): number {
  if (left.order !== right.order) return left.order - right.order
  if (left.stage !== right.stage) return left.stage.localeCompare(right.stage)
  return left.id.localeCompare(right.id)
}
