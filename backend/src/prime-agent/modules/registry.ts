import { hashContextSnapshot } from '../../checkpoint-store.js'
import { dispatchPrimeActions } from '../actions.js'
import { assemblePrimeContext, buildContextSnapshot } from '../context.js'
import type { PrimeAction } from '../llm-router.js'
import { validatePrimeDecision } from '../llm-router.js'
import type { PrimeModule, PrimeModuleDeps, PrimeLoopState } from './types.js'

const TRIGGER_MODULE: PrimeModule = {
  id: 'trigger.event-ingress',
  stage: 'trigger',
  version: '1.0.0',
  order: 10,
  async run(state: PrimeLoopState) {
    return { detail: `accepted ${state.event.type}` }
  },
}

const DEBOUNCE_MODULE: PrimeModule = {
  id: 'debounce.pass-through',
  stage: 'debounce',
  version: '1.0.0',
  order: 20,
  async run() {
    return { detail: 'no debounce policy configured' }
  },
}

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

const POLICY_SCOPE_REQUIRED_MODULE: PrimeModule = {
  id: 'policy.scope-required',
  stage: 'policy',
  version: '1.0.0',
  order: 250,
  async run(state: PrimeLoopState) {
    if (!state.decision) {
      throw new Error('Prime policy module requires a decision')
    }

    const violations = state.decision.actions
      .filter((action) => action.type === 'delegate')
      .filter((action) => requiresAllowedFiles(action))
      .filter((action) => !hasAllowedFiles(action))

    if (violations.length > 0) {
      const capabilities = violations
        .map((action) => String(action.payload['capability'] ?? 'general'))
        .join(', ')
      throw new Error(`Prime policy scope-required blocked delegate actions without allowed_files: ${capabilities}`)
    }

    return { detail: 'all scoped delegate actions passed policy checks' }
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

const FEEDBACK_APPROVAL_CONTINUATION_MODULE: PrimeModule = {
  id: 'feedback.approval-continuation',
  stage: 'feedback',
  version: '1.0.0',
  order: 400,
  async run(state: PrimeLoopState, deps: PrimeModuleDeps) {
    if (!state.context || !state.decision) {
      throw new Error('Prime feedback module requires context and decision')
    }

    let savedCount = 0
    for (const result of state.actions) {
      if (result.approval && !result.approval.status.includes('approved')) {
        await saveApprovalContinuation(deps, state)
        savedCount += 1
      }
    }

    return { detail: savedCount > 0 ? `saved ${savedCount} approval continuations` : 'no approval continuations required' }
  },
}

const STATIC_PRIME_MODULES: PrimeModule[] = [
  TRIGGER_MODULE,
  DEBOUNCE_MODULE,
  CONTEXT_MODULE,
  DECISION_MODULE,
  POLICY_SCOPE_REQUIRED_MODULE,
  ACTION_MODULE,
  FEEDBACK_APPROVAL_CONTINUATION_MODULE,
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

function requiresAllowedFiles(action: PrimeAction): boolean {
  const capability = String(action.payload['capability'] ?? '').trim().toLowerCase()
  return capability === 'implementation' || capability === 'code-exploration'
}

function hasAllowedFiles(action: PrimeAction): boolean {
  const allowedFiles = action.payload['allowed_files']
  return Array.isArray(allowedFiles) && allowedFiles.some((value) => typeof value === 'string' && value.trim() !== '')
}

async function saveApprovalContinuation(deps: PrimeModuleDeps, state: PrimeLoopState): Promise<void> {
  const snapshot = buildContextSnapshot(state.context!)
  await deps.pool.query(
    `INSERT INTO checkpoint_continuations (owner_type, owner_id, step, context_hash, context_snapshot, continuation, status)
     VALUES ('prime_session', $1, 'awaiting_approval', $2, $3, $4, 'pending')`,
    [
      deps.sessionId,
      hashContextSnapshot(snapshot),
      JSON.stringify(snapshot),
      JSON.stringify({ decision: state.decision }),
    ]
  )
}
