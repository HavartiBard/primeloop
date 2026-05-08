import type pg from 'pg'
import { decideApproval, ensurePendingApproval } from '../approvals.js'
import { runDelegation } from '../delegation-runner.js'
import { detectLoopWarnings } from '../loop-detector.js'
import {
  assembleContext,
  checkLessons,
  createSnapshot,
  listMemoryTimeline,
  listSnapshots,
  searchMemories,
  storeLesson,
  storeMemory,
} from '../memory-service.js'
import { getAgent, updateAgent, type RegistryAgent } from '../registry.js'
import {
  createDelegation,
  createWorkItem,
  insertRuntimeEvent,
  updateDelegation,
  updateWorkItem,
} from '../runtime.js'

export interface AgentAuthContext {
  agent: RegistryAgent
  token: string
}

export interface McpToolDefinition {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  annotations?: {
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
    readOnlyHint?: boolean
  }
  prime_only?: boolean
}

interface FleetLearningResult {
  kind: 'memory' | 'lesson'
  agent_id: string
  agent_name: string
  content: string
  category?: string
  importance?: number
  severity?: string
  created_at: string
}

interface JsonSchemaShape {
  type?: string
  properties?: Record<string, JsonSchemaShape & { description?: string; enum?: unknown[] }>
  required?: string[]
  additionalProperties?: boolean
  items?: JsonSchemaShape
  enum?: unknown[]
  minimum?: number
  maximum?: number
}

function hasCapability(agent: RegistryAgent, capability: string): boolean {
  return Array.isArray(agent.capabilities) && agent.capabilities.includes(capability)
}

function isPrime(agent: RegistryAgent): boolean {
  return hasCapability(agent, 'prime')
}

function titleFromPrompt(prompt: string, fallback: string): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  if (!normalized) return fallback
  return normalized.length > 96 ? `${normalized.slice(0, 93)}...` : normalized
}

async function selectAgentForCapability(
  pool: pg.Pool,
  capability: string,
  excludeAgentId?: string,
): Promise<RegistryAgent | null> {
  const { rows } = await pool.query<RegistryAgent>(
    `SELECT *
     FROM agents
     WHERE enabled = true
       AND id <> COALESCE($2::uuid, id)
       AND (
         capabilities @> $1::jsonb
         OR lower(type) = lower($3)
         OR lower(runtime_family) = lower($3)
       )
     ORDER BY
       CASE WHEN capabilities @> $1::jsonb THEN 0 ELSE 1 END,
       created_at ASC
     LIMIT 1`,
    [JSON.stringify([capability]), excludeAgentId ?? null, capability],
  )
  return rows[0] ?? null
}

async function requirePrime(pool: pg.Pool, ctx: AgentAuthContext): Promise<void> {
  const refreshed = await getAgent(pool, ctx.agent.id)
  if (!refreshed || !isPrime(refreshed)) {
    throw new Error('forbidden: prime capability required')
  }
}

export async function authenticateAgentToken(pool: pg.Pool, token: string): Promise<AgentAuthContext | null> {
  const { rows } = await pool.query<RegistryAgent & { token: string }>(
    `SELECT a.*, t.token
     FROM agent_tokens t
     JOIN agents a ON a.id = t.agent_id
     WHERE t.token = $1
     LIMIT 1`,
    [token],
  )
  if (!rows[0]) return null
  const { token: matchedToken, ...agent } = rows[0]
  return { agent, token: matchedToken }
}

const TOOL_DEFINITIONS: McpToolDefinition[] = [
    {
      name: 'delegate_to_agent',
      title: 'Delegate To Agent',
      description: 'Delegate a sub-task to the best available agent for a capability.',
      inputSchema: {
        type: 'object',
        properties: {
          capability: { type: 'string', description: 'Capability to route against, such as implementation or verification.' },
          prompt: { type: 'string', description: 'Task content to give the target agent.' },
          target_agent_id: { type: 'string', description: 'Optional explicit target agent id.' },
          thread_id: { type: 'string', description: 'Optional thread id to associate with the new work item.' },
        },
        required: ['capability', 'prompt'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          work_item: { type: 'object' },
          delegation: { type: 'object' },
          status: { type: 'string' },
          blocked: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['work_item', 'delegation', 'status', 'blocked'],
        additionalProperties: true,
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
    },
    {
      name: 'request_peer_review',
      title: 'Request Peer Review',
      description: 'Request review from another agent, optionally targeting a specific reviewer.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'What should be reviewed, including scope and acceptance concerns.' },
          reviewer_agent_id: { type: 'string', description: 'Optional explicit reviewer agent id.' },
          target_agent_id: { type: 'string', description: 'Legacy alias for reviewer_agent_id.' },
          thread_id: { type: 'string', description: 'Optional thread id to associate with the review request.' },
        },
        required: ['prompt'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          work_item: { type: 'object' },
          delegation: { type: 'object' },
          status: { type: 'string' },
          blocked: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['work_item', 'delegation', 'status', 'blocked'],
        additionalProperties: true,
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
    },
    {
      name: 'request_approval',
      title: 'Request Approval',
      description: 'Create an approval request for a human, Prime, or peer agent.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'The action or decision that requires approval.' },
          approver: {
            type: 'string',
            description: 'Approval target. Use "human", "prime", or a specific agent id.',
          },
          context: {
            type: 'object',
            description: 'Additional structured context, such as PR urls, environment notes, or risk summaries.',
            additionalProperties: true,
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          approval: { type: 'object' },
          work_item: { type: 'object' },
          delegation: { type: 'object' },
          status: { type: 'string' },
        },
        required: ['approval', 'work_item', 'status'],
        additionalProperties: true,
      },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
    },
    {
      name: 'update_work_item',
      title: 'Update Work Item',
      description: 'Update an existing work item status, priority, owner, or notes.',
      inputSchema: {
        type: 'object',
        properties: {
          work_item_id: { type: 'string', description: 'Existing work item id.' },
          title: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: ['active', 'blocked', 'approval', 'review', 'deploy', 'follow-up'] },
          priority: { type: 'string' },
          lane: { type: 'string' },
          blocked_by: { type: 'string' },
          owner_agent_id: { type: 'string' },
          owner_label: { type: 'string' },
          metadata: { type: 'object', additionalProperties: true },
        },
        required: ['work_item_id'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          work_item: { type: 'object' },
        },
        required: ['work_item'],
        additionalProperties: true,
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false, readOnlyHint: false },
    },
    {
      name: 'soul_read',
      title: 'Soul Read',
      description: 'Read the current agent soul definition.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string' },
          soul: { type: 'string' },
        },
        required: ['agent_id', 'soul'],
        additionalProperties: true,
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true },
    },
    {
      name: 'soul_update',
      title: 'Soul Update',
      description: 'Replace the current agent soul definition.',
      inputSchema: {
        type: 'object',
        properties: {
          soul: { type: 'string', description: 'Full replacement soul content.' },
        },
        required: ['soul'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          agent: { type: 'object' },
        },
        required: ['agent'],
        additionalProperties: true,
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false, readOnlyHint: false },
    },
    {
      name: 'memory_store',
      title: 'Memory Store',
      description: 'Persist a memory for the current agent.',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          category: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          importance: { type: 'number', minimum: 1, maximum: 5 },
        },
        required: ['content'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          memory: { type: 'object' },
        },
        required: ['memory'],
        additionalProperties: true,
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
    },
    {
      name: 'memory_search',
      title: 'Memory Search',
      description: 'Search the current agent memories using lexical-first retrieval.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          category: { type: 'string' },
          limit: { type: 'number', minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          memories: { type: 'array', items: { type: 'object' } },
        },
        required: ['memories'],
        additionalProperties: true,
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true },
    },
    {
      name: 'memory_timeline',
      title: 'Memory Timeline',
      description: 'List recent memories for the current agent in reverse chronological order.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', minimum: 1, maximum: 200 },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          memories: { type: 'array', items: { type: 'object' } },
        },
        required: ['memories'],
        additionalProperties: true,
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true },
    },
    {
      name: 'lessons_log',
      title: 'Lessons Log',
      description: 'Persist a lesson for the current agent.',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          context: { type: 'string' },
          category: { type: 'string' },
          severity: { type: 'string', enum: ['info', 'warn', 'error', 'critical'] },
        },
        required: ['content'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          lesson: { type: 'object' },
        },
        required: ['lesson'],
        additionalProperties: true,
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
    },
    {
      name: 'lessons_check',
      title: 'Lessons Check',
      description: 'Search the current agent lessons using lexical-first retrieval.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          category: { type: 'string' },
          limit: { type: 'number', minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          lessons: { type: 'array', items: { type: 'object' } },
        },
        required: ['lessons'],
        additionalProperties: true,
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true },
    },
    {
      name: 'context_get',
      title: 'Context Get',
      description: 'Assemble soul, patterns, memories, and lessons into a prompt-ready context block.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limitPatterns: { type: 'number', minimum: 1, maximum: 20 },
          limitMemories: { type: 'number', minimum: 1, maximum: 20 },
          limitLessons: { type: 'number', minimum: 1, maximum: 20 },
          maxChars: { type: 'number', minimum: 200, maximum: 12000 },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          soul: { type: 'string' },
          patterns: { type: 'array', items: { type: 'object' } },
          memories: { type: 'array', items: { type: 'object' } },
          lessons: { type: 'array', items: { type: 'object' } },
          text: { type: 'string' },
        },
        required: ['soul', 'patterns', 'memories', 'lessons', 'text'],
        additionalProperties: true,
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true },
    },
    {
      name: 'loop_check',
      title: 'Loop Check',
      description: 'Inspect recent delegation and approval behavior for loop/stall indicators.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', minimum: 1, maximum: 50 },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          warnings: { type: 'array', items: { type: 'object' } },
        },
        required: ['warnings'],
        additionalProperties: true,
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true },
    },
    {
      name: 'snapshot_create',
      title: 'Snapshot Create',
      description: 'Persist a compact memory/context snapshot for the current agent.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          query: { type: 'string' },
          maxChars: { type: 'number', minimum: 200, maximum: 12000 },
          metadata: { type: 'object', additionalProperties: true },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          snapshot: { type: 'object' },
        },
        required: ['snapshot'],
        additionalProperties: true,
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false, readOnlyHint: false },
    },
    {
      name: 'save_memory',
      title: 'Save Memory',
      description: 'Store an agent memory or lesson in the fleet database.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['memory', 'lesson'], description: 'Whether to store a memory or a lesson.' },
          content: { type: 'string', description: 'The actual memory or lesson content.' },
          category: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          importance: { type: 'number', minimum: 1, maximum: 5 },
          context: { type: 'string', description: 'Additional lesson context.' },
          severity: { type: 'string', enum: ['info', 'warn', 'error', 'critical'] },
        },
        required: ['content'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          memory: { type: 'object' },
          lesson: { type: 'object' },
        },
        additionalProperties: true,
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
    },
    {
      name: 'query_fleet_learnings',
      title: 'Query Fleet Learnings',
      description: 'Search fleet-wide memories and lessons.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search text matched against memory, lesson, category, and context fields.' },
          limit: { type: 'number', minimum: 1, maximum: 50 },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          results: { type: 'array', items: { type: 'object' } },
        },
        required: ['results'],
        additionalProperties: true,
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true, readOnlyHint: true },
      prime_only: true,
    },
    {
      name: 'publish_pattern',
      title: 'Publish Pattern',
      description: 'Publish a best practice or antipattern to one or more agents.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['best_practice', 'antipattern'] },
          content: { type: 'string' },
          severity: { type: 'string', enum: ['info', 'warn', 'error', 'critical'] },
          source_agent_id: { type: 'string' },
          target_agent_ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['content'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'object' },
          assigned_agent_ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['pattern', 'assigned_agent_ids'],
        additionalProperties: true,
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
      prime_only: true,
    },
    {
      name: 'update_agent_soul',
      title: 'Update Agent Soul',
      description: 'Update another agent’s soul definition.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string' },
          soul: { type: 'string' },
        },
        required: ['agent_id', 'soul'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          agent: { type: 'object' },
        },
        required: ['agent'],
        additionalProperties: true,
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false, readOnlyHint: false },
      prime_only: true,
    },
    {
      name: 'resolve_approval',
      title: 'Resolve Approval',
      description: 'Approve or deny a pending approval.',
      inputSchema: {
        type: 'object',
        properties: {
          approval_id: { type: 'string' },
          decision: { type: 'string', enum: ['approved', 'denied'] },
        },
        required: ['approval_id', 'decision'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          approval: { type: 'object' },
          resumed: { type: 'object' },
        },
        required: ['approval'],
        additionalProperties: true,
      },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false, readOnlyHint: false },
      prime_only: true,
    },
]

function validatePrimitive(path: string, schema: JsonSchemaShape, value: unknown): void {
  if (schema.enum && !schema.enum.includes(value)) {
    throw new Error(`${path} must be one of: ${schema.enum.join(', ')}`)
  }
  if (schema.type === 'string' && typeof value !== 'string') {
    throw new Error(`${path} must be a string`)
  }
  if (schema.type === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) throw new Error(`${path} must be a number`)
    if (schema.minimum != null && value < schema.minimum) throw new Error(`${path} must be >= ${schema.minimum}`)
    if (schema.maximum != null && value > schema.maximum) throw new Error(`${path} must be <= ${schema.maximum}`)
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') {
    throw new Error(`${path} must be a boolean`)
  }
}

function validateValue(path: string, schema: JsonSchemaShape, value: unknown): void {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${path} must be an object`)
    }
    const record = value as Record<string, unknown>
    for (const key of schema.required ?? []) {
      if (!(key in record)) throw new Error(`${path}.${key} is required`)
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(record)) {
        if (!(key in schema.properties)) throw new Error(`${path}.${key} is not allowed`)
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (key in record) validateValue(`${path}.${key}`, childSchema, record[key])
    }
    return
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
    for (let index = 0; index < value.length; index += 1) {
      if (schema.items) validateValue(`${path}[${index}]`, schema.items, value[index])
    }
    return
  }

  validatePrimitive(path, schema, value)
}

export async function listControlPlaneTools(): Promise<McpToolDefinition[]> {
  return TOOL_DEFINITIONS
}

export function getControlPlaneToolDefinition(name: string): McpToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((tool) => tool.name === name)
}

export function validateToolArguments(name: string, args: Record<string, unknown>): void {
  const tool = getControlPlaneToolDefinition(name)
  if (!tool) throw new Error(`unknown tool: ${name}`)
  validateValue('arguments', tool.inputSchema as JsonSchemaShape, args)
}

async function delegateToAgent(
  pool: pg.Pool,
  ctx: AgentAuthContext,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const capability = typeof args['capability'] === 'string' ? args['capability'] : ''
  const prompt = typeof args['prompt'] === 'string' ? args['prompt'] : ''
  const targetAgentId = typeof args['target_agent_id'] === 'string' ? args['target_agent_id'] : undefined
  const threadId = typeof args['thread_id'] === 'string' ? args['thread_id'] : undefined

  if (!capability) throw new Error('capability is required')
  const target = targetAgentId
    ? await getAgent(pool, targetAgentId)
    : await selectAgentForCapability(pool, capability, ctx.agent.id)
  if (!target || !target.enabled) throw new Error('no enabled target agent found')

  const workItem = await createWorkItem(pool, {
    title: titleFromPrompt(prompt, `Delegation: ${capability}`),
    description: prompt,
    lane: capability,
    status: 'active',
    owner_agent_id: target.id,
    owner_label: target.name,
    metadata: {
      source: 'control-plane-mcp',
      requested_by: ctx.agent.id,
      requested_by_name: ctx.agent.name,
    },
    ...(threadId ? { thread_id: threadId } : {}),
  })

  const delegation = await createDelegation(pool, {
    work_item_id: workItem.id,
    from_agent_id: ctx.agent.id,
    to_agent_id: target.id,
    capability,
    request: {
      content: prompt,
      thread_id: threadId,
      source_agent_id: ctx.agent.id,
      source_agent_name: ctx.agent.name,
    },
  })

  const run = await runDelegation(pool, delegation.id)
  return {
    work_item: workItem,
    delegation: run.delegation,
    status: run.status,
    blocked: run.blocked,
    reason: run.reason,
  }
}

async function requestPeerReview(
  pool: pg.Pool,
  ctx: AgentAuthContext,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return delegateToAgent(pool, ctx, {
    capability: 'verification',
    prompt: typeof args['prompt'] === 'string' ? args['prompt'] : '',
    target_agent_id: typeof args['reviewer_agent_id'] === 'string' ? args['reviewer_agent_id'] : args['target_agent_id'],
    thread_id: args['thread_id'],
  })
}

async function requestApproval(
  pool: pg.Pool,
  ctx: AgentAuthContext,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const action = typeof args['action'] === 'string' ? args['action'] : ''
  const approver = typeof args['approver'] === 'string' ? args['approver'] : 'human'
  const context = typeof args['context'] === 'object' && args['context'] && !Array.isArray(args['context'])
    ? args['context'] as Record<string, unknown>
    : {}
  if (!action) throw new Error('action is required')

  const workItem = await createWorkItem(pool, {
    title: titleFromPrompt(action, 'Approval request'),
    description: action,
    lane: 'approval',
    status: 'approval',
    owner_label: approver === 'human' ? 'Human approval' : 'Approval flow',
    metadata: {
      source: 'control-plane-mcp',
      approver,
      context,
      requested_by: ctx.agent.id,
    },
  })

  const approvalId = `mcp:${workItem.id}`
  const approval = await ensurePendingApproval(pool, {
    approval_id: approvalId,
    run_id: workItem.id,
    action,
  })

  await insertRuntimeEvent(pool, {
    event_type: 'approval.needed',
    actor: ctx.agent.name,
    work_item_id: workItem.id,
    payload: { approval_id: approval.approval_id, approver, context },
  })

  if (approver === 'prime') {
    const prime = await selectAgentForCapability(pool, 'prime', ctx.agent.id)
    if (!prime) throw new Error('no prime agent available')
    const delegation = await createDelegation(pool, {
      work_item_id: workItem.id,
      from_agent_id: ctx.agent.id,
      to_agent_id: prime.id,
      capability: 'approval',
      request: {
        content: action,
        context,
        approval_id: approval.approval_id,
      },
    })
    const run = await runDelegation(pool, delegation.id)
    return { approval, work_item: workItem, delegation: run.delegation, status: run.status }
  }

  if (approver !== 'human') {
    const reviewer = await getAgent(pool, approver)
    if (!reviewer || !reviewer.enabled) throw new Error('specified approver agent is unavailable')
    const delegation = await createDelegation(pool, {
      work_item_id: workItem.id,
      from_agent_id: ctx.agent.id,
      to_agent_id: reviewer.id,
      capability: 'verification',
      request: {
        content: action,
        context,
        approval_id: approval.approval_id,
      },
    })
    const run = await runDelegation(pool, delegation.id)
    return { approval, work_item: workItem, delegation: run.delegation, status: run.status }
  }

  return { approval, work_item: workItem, status: 'pending' }
}

async function updateWorkItemTool(
  pool: pg.Pool,
  ctx: AgentAuthContext,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const workItemId = typeof args['work_item_id'] === 'string' ? args['work_item_id'] : ''
  if (!workItemId) throw new Error('work_item_id is required')

  const metadata = typeof args['metadata'] === 'object' && args['metadata'] && !Array.isArray(args['metadata'])
    ? args['metadata'] as Record<string, unknown>
    : undefined

  const updated = await updateWorkItem(pool, workItemId, {
    ...(typeof args['status'] === 'string' ? { status: args['status'] } : {}),
    ...(typeof args['priority'] === 'string' ? { priority: args['priority'] } : {}),
    ...(typeof args['lane'] === 'string' ? { lane: args['lane'] } : {}),
    ...(typeof args['blocked_by'] === 'string' ? { blocked_by: args['blocked_by'] } : {}),
    ...(typeof args['owner_agent_id'] === 'string' ? { owner_agent_id: args['owner_agent_id'] } : {}),
    ...(typeof args['owner_label'] === 'string' ? { owner_label: args['owner_label'] } : {}),
    ...(typeof args['title'] === 'string' ? { title: args['title'] } : {}),
    ...(typeof args['description'] === 'string' ? { description: args['description'] } : {}),
    ...(metadata ? { metadata } : {}),
  })
  if (!updated) throw new Error('work item not found')

  await insertRuntimeEvent(pool, {
    event_type: 'work.updated.by-agent',
    actor: ctx.agent.name,
    work_item_id: updated.id,
    payload: { updated_by: ctx.agent.id },
  })

  return { work_item: updated }
}

async function soulReadTool(
  _pool: pg.Pool,
  ctx: AgentAuthContext,
): Promise<Record<string, unknown>> {
  return {
    agent_id: ctx.agent.id,
    soul: ctx.agent.soul ?? '',
  }
}

async function soulUpdateTool(
  pool: pg.Pool,
  ctx: AgentAuthContext,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const soul = typeof args['soul'] === 'string' ? args['soul'] : ''
  const agent = await updateAgent(pool, ctx.agent.id, { soul })
  return { agent }
}

async function memoryStoreTool(
  pool: pg.Pool,
  ctx: AgentAuthContext,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const memory = await storeMemory(pool, ctx.agent.id, {
    content: String(args['content']),
    category: typeof args['category'] === 'string' ? args['category'] : undefined,
    tags: Array.isArray(args['tags']) ? args['tags'].map((tag) => String(tag)) : undefined,
    importance: typeof args['importance'] === 'number' ? args['importance'] : undefined,
  })
  return { memory }
}

async function memorySearchTool(
  pool: pg.Pool,
  ctx: AgentAuthContext,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const memories = await searchMemories(
    pool,
    ctx.agent.id,
    typeof args['query'] === 'string' ? args['query'] : '',
    {
      category: typeof args['category'] === 'string' ? args['category'] : undefined,
      limit: typeof args['limit'] === 'number' ? args['limit'] : undefined,
    },
  )
  return { memories }
}

async function memoryTimelineTool(
  pool: pg.Pool,
  ctx: AgentAuthContext,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const memories = await listMemoryTimeline(pool, ctx.agent.id, {
    limit: typeof args['limit'] === 'number' ? args['limit'] : undefined,
  })
  return { memories }
}

async function lessonsLogTool(
  pool: pg.Pool,
  ctx: AgentAuthContext,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const lesson = await storeLesson(pool, ctx.agent.id, {
    content: String(args['content']),
    context: typeof args['context'] === 'string' ? args['context'] : undefined,
    category: typeof args['category'] === 'string' ? args['category'] : undefined,
    severity: typeof args['severity'] === 'string' ? args['severity'] : undefined,
  })
  return { lesson }
}

async function lessonsCheckTool(
  pool: pg.Pool,
  ctx: AgentAuthContext,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const lessons = await checkLessons(
    pool,
    ctx.agent.id,
    typeof args['query'] === 'string' ? args['query'] : '',
    {
      category: typeof args['category'] === 'string' ? args['category'] : undefined,
      limit: typeof args['limit'] === 'number' ? args['limit'] : undefined,
    },
  )
  return { lessons }
}

async function contextGetTool(
  pool: pg.Pool,
  ctx: AgentAuthContext,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const context = await assembleContext(pool, ctx.agent.id, {
    query: typeof args['query'] === 'string' ? args['query'] : undefined,
    limitPatterns: typeof args['limitPatterns'] === 'number' ? args['limitPatterns'] : undefined,
    limitMemories: typeof args['limitMemories'] === 'number' ? args['limitMemories'] : undefined,
    limitLessons: typeof args['limitLessons'] === 'number' ? args['limitLessons'] : undefined,
    maxChars: typeof args['maxChars'] === 'number' ? args['maxChars'] : undefined,
  })
  return {
    soul: context.soul,
    patterns: context.patterns,
    memories: context.memories,
    lessons: context.lessons,
    text: context.text,
  }
}

async function loopCheckTool(
  pool: pg.Pool,
  ctx: AgentAuthContext,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const warnings = await detectLoopWarnings(pool, ctx.agent.id, {
    limit: typeof args['limit'] === 'number' ? args['limit'] : undefined,
  })
  return { warnings }
}

async function snapshotCreateTool(
  pool: pg.Pool,
  ctx: AgentAuthContext,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const context = await assembleContext(pool, ctx.agent.id, {
    query: typeof args['query'] === 'string' ? args['query'] : undefined,
    maxChars: typeof args['maxChars'] === 'number' ? args['maxChars'] : undefined,
  })
  const title = typeof args['title'] === 'string' && args['title'].trim()
    ? args['title']
    : `Snapshot ${new Date().toISOString()}`
  const metadata = typeof args['metadata'] === 'object' && args['metadata'] && !Array.isArray(args['metadata'])
    ? args['metadata'] as Record<string, unknown>
    : {}

  const snapshot = await createSnapshot(pool, ctx.agent.id, {
    title,
    summary: context.text.slice(0, 240),
    payload: {
      soul: context.soul,
      patterns: context.patterns,
      memories: context.memories,
      lessons: context.lessons,
      text: context.text,
      metadata,
    },
  })
  return { snapshot }
}

async function saveMemoryTool(
  pool: pg.Pool,
  ctx: AgentAuthContext,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const kind = args['kind'] === 'lesson' ? 'lesson' : 'memory'

  if (kind === 'lesson') {
    const lesson = await storeLesson(pool, ctx.agent.id, {
      content: String(args['content']),
      context: typeof args['context'] === 'string' ? args['context'] : undefined,
      category: typeof args['category'] === 'string' ? args['category'] : undefined,
      severity: typeof args['severity'] === 'string' ? args['severity'] : undefined,
    })
    return { lesson }
  }

  const memory = await storeMemory(pool, ctx.agent.id, {
    content: String(args['content']),
    category: typeof args['category'] === 'string' ? args['category'] : undefined,
    tags: Array.isArray(args['tags']) ? args['tags'].map((tag) => String(tag)) : undefined,
    importance: typeof args['importance'] === 'number' ? args['importance'] : undefined,
  })
  return { memory }
}

async function queryFleetLearnings(
  pool: pg.Pool,
  ctx: AgentAuthContext,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  await requirePrime(pool, ctx)
  const query = typeof args['query'] === 'string' ? args['query'].trim() : ''
  const limit = Math.max(1, Math.min(typeof args['limit'] === 'number' ? args['limit'] : 20, 50))
  const like = query ? `%${query}%` : '%'
  const { rows } = await pool.query<FleetLearningResult>(
    `SELECT * FROM (
       SELECT
         'memory'::text AS kind,
         m.agent_id,
         a.name AS agent_name,
         m.content,
         m.category,
         m.importance,
         NULL::text AS severity,
         m.created_at::text
       FROM agent_memories m
       JOIN agents a ON a.id = m.agent_id
       WHERE $1 = '%' OR m.content ILIKE $1 OR COALESCE(m.category, '') ILIKE $1
       UNION ALL
       SELECT
         'lesson'::text AS kind,
         l.agent_id,
         a.name AS agent_name,
         l.content,
         l.category,
         NULL::int AS importance,
         l.severity,
         l.created_at::text
       FROM agent_lessons l
       JOIN agents a ON a.id = l.agent_id
       WHERE $1 = '%' OR l.content ILIKE $1 OR COALESCE(l.category, '') ILIKE $1 OR COALESCE(l.context, '') ILIKE $1
     ) fleet
     ORDER BY created_at DESC
     LIMIT $2`,
    [like, limit],
  )
  return { results: rows }
}

async function publishPattern(
  pool: pg.Pool,
  ctx: AgentAuthContext,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  await requirePrime(pool, ctx)
  const type = args['type'] === 'antipattern' ? 'antipattern' : 'best_practice'
  const content = typeof args['content'] === 'string' ? args['content'] : ''
  if (!content) throw new Error('content is required')

  const { rows } = await pool.query<{ id: string; type: string; content: string; severity: string; created_at: string }>(
    `INSERT INTO agent_patterns (type, content, severity, source_agent_id, published_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, type, content, severity, created_at::text`,
    [
      type,
      content,
      typeof args['severity'] === 'string' ? args['severity'] : 'info',
      typeof args['source_agent_id'] === 'string' ? args['source_agent_id'] : ctx.agent.id,
      ctx.agent.id,
    ],
  )
  const pattern = rows[0]

  let targetAgentIds: string[] = []
  if (Array.isArray(args['target_agent_ids']) && args['target_agent_ids'].length > 0) {
    targetAgentIds = args['target_agent_ids'].map((id) => String(id))
  } else {
    const { rows: agentRows } = await pool.query<{ id: string }>('SELECT id FROM agents WHERE enabled = true')
    targetAgentIds = agentRows.map((row) => row.id)
  }

  for (const agentId of targetAgentIds) {
    await pool.query(
      `INSERT INTO agent_pattern_assignments (pattern_id, agent_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [pattern.id, agentId],
    )
  }

  return { pattern, assigned_agent_ids: targetAgentIds }
}

async function updateAgentSoul(
  pool: pg.Pool,
  ctx: AgentAuthContext,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  await requirePrime(pool, ctx)
  const agentId = typeof args['agent_id'] === 'string' ? args['agent_id'] : ''
  const soul = typeof args['soul'] === 'string' ? args['soul'] : ''
  if (!agentId || !soul) throw new Error('agent_id and soul are required')
  const updated = await updateAgent(pool, agentId, { soul })
  return { agent: updated }
}

async function resolveApprovalTool(
  pool: pg.Pool,
  ctx: AgentAuthContext,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  await requirePrime(pool, ctx)
  const approvalId = typeof args['approval_id'] === 'string' ? args['approval_id'] : ''
  const decision = args['decision'] === 'denied' ? 'denied' : 'approved'
  if (!approvalId) throw new Error('approval_id is required')

  const approval = await decideApproval(pool, approvalId, decision)
  if (!approval) throw new Error('approval not found')

  let resumed: Awaited<ReturnType<typeof runDelegation>> | null = null
  if (decision === 'approved' && !approval.approval_id.startsWith('delegation:')) {
    await insertRuntimeEvent(pool, {
      event_type: 'approval.approved',
      actor: ctx.agent.name,
      work_item_id: approval.run_id,
      payload: { approval_id: approval.approval_id, run_id: approval.run_id },
    })
  } else if (decision === 'approved') {
    resumed = await runDelegation(pool, approval.run_id)
  } else if (approval.approval_id.startsWith('delegation:')) {
    const delegation = await updateDelegation(pool, approval.run_id, {
      status: 'blocked',
      result: { denied: true, approval_id: approval.approval_id },
    })
    if (delegation?.work_item_id) {
      await updateWorkItem(pool, delegation.work_item_id, {
        status: 'blocked',
        blocked_by: 'approval-denied',
      })
    }
  }

  return { approval, resumed }
}

export async function callControlPlaneTool(
  pool: pg.Pool,
  ctx: AgentAuthContext,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  validateToolArguments(name, args)
  switch (name) {
    case 'soul_read':
      return soulReadTool(pool, ctx)
    case 'soul_update':
      return soulUpdateTool(pool, ctx, args)
    case 'memory_store':
      return memoryStoreTool(pool, ctx, args)
    case 'memory_search':
      return memorySearchTool(pool, ctx, args)
    case 'memory_timeline':
      return memoryTimelineTool(pool, ctx, args)
    case 'lessons_log':
      return lessonsLogTool(pool, ctx, args)
    case 'lessons_check':
      return lessonsCheckTool(pool, ctx, args)
    case 'context_get':
      return contextGetTool(pool, ctx, args)
    case 'loop_check':
      return loopCheckTool(pool, ctx, args)
    case 'snapshot_create':
      return snapshotCreateTool(pool, ctx, args)
    case 'delegate_to_agent':
      return delegateToAgent(pool, ctx, args)
    case 'request_peer_review':
      return requestPeerReview(pool, ctx, args)
    case 'request_approval':
      return requestApproval(pool, ctx, args)
    case 'update_work_item':
      return updateWorkItemTool(pool, ctx, args)
    case 'save_memory':
      return saveMemoryTool(pool, ctx, args)
    case 'query_fleet_learnings':
      return queryFleetLearnings(pool, ctx, args)
    case 'publish_pattern':
      return publishPattern(pool, ctx, args)
    case 'update_agent_soul':
      return updateAgentSoul(pool, ctx, args)
    case 'resolve_approval':
      return resolveApprovalTool(pool, ctx, args)
    default:
      throw new Error(`unknown tool: ${name}`)
  }
}
