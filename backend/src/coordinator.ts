import type pg from 'pg'
import { getPrimeConfig } from './prime-agent/config.js'
import type { RegistryAgent } from './registry.js'
import type { PrimeQueue } from './prime-agent/queue.js'
import type { PrimeEvent } from './prime-agent/events.js'
import {
  appendThreadMessage,
  createDelegation,
  createMemory,
  createWorkItem,
  getPrimeProfile,
  insertRuntimeEvent,
  type Delegation,
  type ThreadMessage,
  type WorkItem,
} from './runtime.js'

let primeQueue: PrimeQueue | undefined
let primeProcessor: ((event: PrimeEvent) => Promise<void>) | undefined

export function setPrimeCoordinatorQueue(queue: PrimeQueue): void {
  primeQueue = queue
}

export function getPrimeCoordinatorQueue(): PrimeQueue | undefined {
  return primeQueue
}

export function setPrimeCoordinatorProcessor(processor: ((event: PrimeEvent) => Promise<void>) | undefined): void {
  primeProcessor = processor
}

export interface PrimeRoute {
  capability: string
  lane: string
  priority: string
  status: string
  requiresApproval: boolean
  reason: string
}

export interface PrimeMessageResult {
  user_message: ThreadMessage
  prime_message?: ThreadMessage
  work_item: WorkItem
  delegation?: Delegation
  selected_agent?: RegistryAgent
  route: PrimeRoute
}

const ROUTES: Array<{ capability: string; lane: string; patterns: RegExp[]; reason: string }> = [
  {
    capability: 'operational-audit',
    lane: 'operations',
    patterns: [/audit/i, /stale/i, /queue/i, /follow[- ]?up/i, /open work/i, /health/i],
    reason: 'The request is asking for operational inspection or queue hygiene.',
  },
  {
    capability: 'research',
    lane: 'research',
    patterns: [/research/i, /investigate/i, /docs?/i, /find out/i, /compare/i],
    reason: 'The request requires investigation before action.',
  },
  {
    capability: 'code-exploration',
    lane: 'exploration',
    patterns: [/explore/i, /map/i, /trace/i, /understand/i, /where is/i],
    reason: 'The request needs codebase discovery before implementation.',
  },
  {
    capability: 'implementation',
    lane: 'implementation',
    patterns: [/implement/i, /\bfix\b/i, /\bbuild\b/i, /\badd\b/i, /refactor/i, /change/i],
    reason: 'The request asks for a concrete implementation change.',
  },
  {
    capability: 'verification',
    lane: 'verification',
    patterns: [/verify/i, /\btest\b/i, /review/i, /validate/i, /regression/i],
    reason: 'The request centers on verification, testing, or review.',
  },
  {
    capability: 'deployment',
    lane: 'deployment',
    patterns: [/deploy/i, /release/i, /rollout/i, /push/i, /production/i],
    reason: 'The request touches deployment or publication.',
  },
]

const APPROVAL_PATTERNS = [
  /delete/i,
  /destroy/i,
  /reset/i,
  /reboot/i,
  /restart/i,
  /stop/i,
  /deploy/i,
  /push/i,
  /publish/i,
  /secret/i,
  /credential/i,
]

export function classifyPrimeRequest(content: string): PrimeRoute {
  const route = ROUTES.find((candidate) => candidate.patterns.some((pattern) => pattern.test(content)))
  const requiresApproval = APPROVAL_PATTERNS.some((pattern) => pattern.test(content))

  if (route) {
    return {
      capability: route.capability,
      lane: route.lane,
      priority: requiresApproval ? 'high' : 'normal',
      status: requiresApproval ? 'approval' : 'active',
      requiresApproval,
      reason: route.reason,
    }
  }

  return {
    capability: 'coordination',
    lane: 'intake',
    priority: 'normal',
    status: requiresApproval ? 'approval' : 'active',
    requiresApproval,
    reason: 'The request needs coordination intake before specialist routing.',
  }
}

function titleFromContent(content: string): string {
  const title = content.replace(/\s+/g, ' ').trim()
  return title.length > 96 ? `${title.slice(0, 93)}...` : title || 'Operations request'
}

async function selectAgentForCapability(pool: pg.Pool, route: PrimeRoute): Promise<RegistryAgent | undefined> {
  const { rows } = await pool.query<RegistryAgent>(
    `SELECT *
     FROM agents
     WHERE enabled = true
       AND (
         capabilities @> $1::jsonb
         OR capabilities @> $2::jsonb
         OR lower(type) = lower($3)
         OR lower(runtime_family) = lower($3)
       )
     ORDER BY
       CASE WHEN capabilities @> $1::jsonb THEN 0 ELSE 1 END,
       created_at ASC
     LIMIT 1`,
    [
      JSON.stringify([route.capability]),
      JSON.stringify([route.lane]),
      route.capability,
    ]
  )
  return rows[0]
}

function primeResponse(
  route: PrimeRoute,
  workItem: WorkItem,
  coordinatorName: string,
  agent?: RegistryAgent,
  delegation?: Delegation
): string {
  const routeText = `I logged this as ${workItem.lane}/${route.capability} work.`
  const approvalText = route.requiresApproval
    ? 'It is parked in the approval lane before any risky execution.'
    : 'It is active and ready for execution.'
  const delegationText = agent && delegation
    ? `I queued a delegation to ${agent.name} using capability ${delegation.capability}.`
    : `No matching enabled subagent is registered yet, so I am holding it in the ${coordinatorName} queue.`

  return `${routeText} ${approvalText} ${delegationText}`
}

export async function handlePrimeMessage(
  pool: pg.Pool,
  threadId: string,
  content: string,
  sender = 'james'
): Promise<PrimeMessageResult> {
  const primeProfile = await getPrimeProfile(pool)
  const coordinatorName = primeProfile.name.trim() || 'Prime'
  const userMessage = await appendThreadMessage(pool, threadId, {
    role: 'user',
    sender,
    content,
    metadata: { source: 'prime-desk' },
  })

  const primeConfig = primeQueue ? await getPrimeConfig(pool) : null
  if (primeQueue && primeConfig?.enabled) {
    const route: PrimeRoute = {
      capability: 'coordination',
      lane: 'intake',
      priority: 'normal',
      status: 'active',
      requiresApproval: false,
      reason: `${coordinatorName} intake is enabled for message routing.`,
    }

    const workItem = await createWorkItem(pool, {
      title: titleFromContent(content),
      description: content,
      status: route.status,
      priority: route.priority,
      lane: route.lane,
      owner_label: coordinatorName,
      thread_id: threadId,
      metadata: {
        source: 'prime-agent-intake',
        message_id: userMessage.id,
      },
    })

    const primeEvent: PrimeEvent = {
      type: 'prime.message',
      payload: {
        thread_id: threadId,
        message_id: userMessage.id,
        content,
        sender,
      },
    }
    if (primeProcessor) {
      void primeProcessor(primeEvent)
    } else {
      await primeQueue.enqueue(primeEvent)
    }

    await insertRuntimeEvent(pool, {
      event_type: 'prime.routed',
      actor: coordinatorName,
      thread_id: threadId,
      work_item_id: workItem.id,
      payload: {
        message_id: userMessage.id,
        prime_enabled: true,
      },
    })

    let primeMessage: ThreadMessage | undefined
    if (!primeProcessor) {
      primeMessage = await appendThreadMessage(pool, threadId, {
        role: 'assistant',
        sender: coordinatorName,
        content: 'I could not process that yet because Prime processing is not running.',
        metadata: {
          route,
          work_item_id: workItem.id,
          prime_processing: false,
        },
      })
    }

    return {
      user_message: userMessage,
      ...(primeMessage ? { prime_message: primeMessage } : {}),
      work_item: workItem,
      route,
    }
  }

  const route = classifyPrimeRequest(content)

  const selectedAgent = await selectAgentForCapability(pool, route)
  const workItem = await createWorkItem(pool, {
    title: titleFromContent(content),
    description: content,
    status: route.status,
    priority: route.priority,
    lane: route.lane,
    owner_agent_id: selectedAgent?.id,
    owner_label: selectedAgent?.name ?? coordinatorName,
    thread_id: threadId,
    metadata: {
      source: 'prime-desk',
      route,
      selected_agent_id: selectedAgent?.id,
    },
  })

  let delegation: Delegation | undefined
  if (selectedAgent) {
    delegation = await createDelegation(pool, {
      work_item_id: workItem.id,
      to_agent_id: selectedAgent.id,
      status: route.requiresApproval ? 'blocked' : 'queued',
      capability: route.capability,
      request: {
        thread_id: threadId,
        message_id: userMessage.id,
        content,
        route,
      },
    })
  }

  if (/remember|prefer|preference/i.test(content)) {
    await createMemory(pool, {
      category: /prefer|preference/i.test(content) ? 'preference' : 'note',
      content,
      source_thread_id: threadId,
      metadata: { source: 'prime-desk' },
    })
  }

  const response = primeResponse(route, workItem, coordinatorName, selectedAgent, delegation)
  const primeMessage = await appendThreadMessage(pool, threadId, {
    role: 'assistant',
    sender: coordinatorName,
    content: response,
    metadata: {
      route,
      work_item_id: workItem.id,
      delegation_id: delegation?.id,
      selected_agent_id: selectedAgent?.id,
    },
  })

  await insertRuntimeEvent(pool, {
    event_type: 'prime.routed',
    actor: coordinatorName,
    thread_id: threadId,
    work_item_id: workItem.id,
    delegation_id: delegation?.id,
    payload: {
      capability: route.capability,
      lane: route.lane,
      selected_agent_id: selectedAgent?.id,
      requires_approval: route.requiresApproval,
    },
  })

  return {
    user_message: userMessage,
    prime_message: primeMessage,
    work_item: workItem,
    delegation,
    selected_agent: selectedAgent,
    route,
  }
}
