// ─────────────────────────────────────────────────────────────────────────────
// Circuit View Model (spec 017)
// Derive CircuitCanvasView from existing Primeloop records
// ─────────────────────────────────────────────────────────────────────────────

import type {
  RegistryAgent,
  RuntimeThread,
  RuntimeWorkItem,
  RuntimeDelegation,
  RuntimeAuditLoop,
  CircuitCanvasView,
  CircuitNode,
  CircuitEdge,
  CanvasViewport,
  CircuitNodeType,
  CircuitNodeStatus,
} from '../types'

// ─── Layout Constants ────────────────────────────────────────────────────────

const CANVAS_W = 1296
const CANVAS_H = 768
const NODE_W = 176
const ROOM_W = 192
const NODE_H = 96
const ROW_Y = [48, 192, 336, 480, 624] as const

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Calculate row positions for nodes
 */
function calculateRowPositions(count: number, nodeWidth = NODE_W): number[] {
  if (count === 0) return []
  const spacing = CANVAS_W / (count + 1)
  return Array.from({ length: count }, (_, i) => Math.round((i + 1) * spacing - nodeWidth / 2))
}

/**
 * Derive circuit node status from work item status
 */
function deriveNodeStatusFromWorkItem(status: string): CircuitNodeStatus {
  const normalized = status.toLowerCase()
  if (normalized === 'active') return 'active'
  if (normalized === 'blocked') return 'blocked'
  if (normalized === 'queued' || normalized === 'running') return 'running'
  return 'neutral'
}

/**
 * Derive circuit node status from delegation status
 */
function deriveNodeStatusFromDelegation(status: string): CircuitNodeStatus {
  const normalized = status.toLowerCase()
  if (normalized === 'running') return 'running'
  if (normalized === 'completed') return 'active'
  if (normalized === 'failed' || normalized === 'blocked') return 'blocked'
  return 'neutral'
}

/**
 * Derive circuit node status from approval status
 */
function deriveNodeStatusFromApproval(status: string): CircuitNodeStatus {
  const normalized = status.toLowerCase()
  if (normalized === 'pending') return 'approval'
  if (normalized === 'approved') return 'active'
  if (normalized === 'denied' || normalized === 'rejected') return 'blocked'
  return 'neutral'
}

/**
 * Create a circuit node
 */
function createNode(
  id: string,
  type: CircuitNodeType,
  title: string,
  summary: string,
  status: CircuitNodeStatus,
  x: number,
  y: number,
  chips: string[] = [],
): CircuitNode {
  return {
    id,
    type,
    title,
    summary,
    status,
    position: { x, y },
    collapsedDetails: chips.slice(0, 2),
    expandedDetails: chips.length > 2 ? { context: chips.slice(2) } : undefined,
  }
}

/**
 * Create a circuit edge
 */
function createEdge(
  fromNodeId: string,
  toNodeId: string,
  relationship: CircuitEdge['relationship'],
): CircuitEdge {
  return {
    id: `${fromNodeId}-${toNodeId}`,
    fromNodeId,
    toNodeId,
    relationship,
  }
}

// ─── Graph Building ──────────────────────────────────────────────────────────

/**
 * Build circuit graph from runtime data
 */
export function buildCircuitGraph(
  primeName: string,
  agents: RegistryAgent[],
  threads: RuntimeThread[],
  workItems: RuntimeWorkItem[],
  delegations: RuntimeDelegation[],
  auditLoops: RuntimeAuditLoop[],
): { nodes: CircuitNode[]; edges: CircuitEdge[] } {
  const nodes: CircuitNode[] = []
  const edges: CircuitEdge[] = []

  // ─── Row 0: Prime ────────────────────────────────────────────────────────
  const activeCount = workItems.filter((i) => i.status === 'active').length
  const blockedCount = workItems.filter((i) => i.status === 'blocked').length
  const primeChips: string[] = []
  if (activeCount) primeChips.push(`${activeCount} active`)
  if (blockedCount) primeChips.push(`${blockedCount} blocked`)
  if (!primeChips.length) primeChips.push('idle')

  const primeNode = createNode(
    'prime',
    'prime',
    primeName,
    'coordinator · delegate · approve',
    blockedCount > 0 ? 'blocked' : 'active',
    Math.round(CANVAS_W / 2 - NODE_W / 2),
    ROW_Y[0],
    primeChips,
  )
  nodes.push(primeNode)

  // ─── Row 1: Agents ───────────────────────────────────────────────────────
  const agentXs = calculateRowPositions(agents.length)
  agents.forEach((agent, i) => {
    const agentItems = workItems.filter((wi) => wi.owner_agent_id === agent.id)
    const chips: string[] = []
    const aActive = agentItems.filter((it) => it.status === 'active').length
    const aBlocked = agentItems.filter((it) => it.status === 'blocked').length
    if (aActive) chips.push(`${aActive} active`)
    if (aBlocked) chips.push(`${aBlocked} blocked`)
    if (!chips.length)
      chips.push(agent.execution_mode || agent.type)

    const id = `agent-${agent.id}`
    const node = createNode(
      id,
      'agent',
      agent.name,
      [agent.type, agent.runtime_family].filter(Boolean).join(' · '),
      !agent.enabled ? 'neutral' : 'active',
      agentXs[i],
      ROW_Y[1],
      chips,
    )
    nodes.push(node)
    edges.push(createEdge('prime', id, 'coordinates'))

    // Add work items for this agent
    agentItems.forEach((item) => {
      const workId = `work-${item.id}`
      const workNode = createNode(
        workId,
        'work_item',
        item.title,
        [item.owner_label, item.lane].filter(Boolean).join(' · '),
        deriveNodeStatusFromWorkItem(item.status),
        Math.round(CANVAS_W / 2 - NODE_W / 2),
        ROW_Y[3],
        [item.status, item.priority || 'medium'],
      )
      nodes.push(workNode)
      edges.push(createEdge(id, workId, 'owns'))
    })
  })

  // ─── Row 2: Threads / Rooms ──────────────────────────────────────────────
  const threadXs = calculateRowPositions(threads.length, ROOM_W)
  threads.forEach((thread, i) => {
    const items = workItems.filter((wi) => wi.thread_id === thread.id)
    const delegs = delegations.filter((d) => d.work_item_id && items.some((it) => it.id === d.work_item_id))
    const chips: string[] = []
    const tActive = items.filter((it) => it.status === 'active').length
    const tBlocked = items.filter((it) => it.status === 'blocked').length
    if (tActive) chips.push(`${tActive} active`)
    if (tBlocked) chips.push(`${tBlocked} blocked`)
    if (!chips.length) chips.push(`${items.length} items`)

    const id = `thread-${thread.id}`
    const node = createNode(
      id,
      'room',
      thread.title || 'Untitled',
      `${items.length} item${items.length === 1 ? '' : 's'}`,
      thread.status === 'closed' ? 'neutral' : 'active',
      threadXs[i],
      ROW_Y[2],
      chips,
    )
    nodes.push(node)
    edges.push(createEdge('prime', id, 'coordinates'))

    // Connect agents to this room
    const roomAgents = new Set<string>()
    items.forEach((wi) => {
      if (wi.owner_agent_id) {
        roomAgents.add(`agent-${wi.owner_agent_id}`)
      }
    })
    roomAgents.forEach((agentId) => {
      edges.push(createEdge(agentId, id, 'participates'))
    })
  })

  // ─── Row 3: Work Items (standalone) ──────────────────────────────────────
  const workXs = calculateRowPositions(workItems.length)
  workItems.forEach((item, i) => {
    // Skip if already added as part of an agent or thread
    if (item.owner_agent_id || item.thread_id) return

    const id = `work-${item.id}`
    const node = createNode(
      id,
      'work_item',
      item.title,
      [item.owner_label, item.lane].filter(Boolean).join(' · '),
      deriveNodeStatusFromWorkItem(item.status),
      workXs[i],
      ROW_Y[3],
      [item.status, item.priority || 'medium'],
    )
    nodes.push(node)
    edges.push(createEdge('prime', id, 'coordinates'))
  })

  // ─── Row 4: Audit Loops ──────────────────────────────────────────────────
  const auditXs = calculateRowPositions(auditLoops.length)
  auditLoops.forEach((loop, i) => {
    const id = `audit-${loop.id}`
    const node = createNode(
      id,
      'system',
      loop.name,
      (loop.purpose || '').slice(0, 44),
      'neutral',
      auditXs[i],
      ROW_Y[4],
      [loop.cadence_cron],
    )
    nodes.push(node)
    edges.push(createEdge('prime', id, 'coordinates'))
  })

  return { nodes, edges }
}

// ─── Density State ───────────────────────────────────────────────────────────

/**
 * Calculate density state based on node count
 */
export function calculateDensityState(nodeCount: number): CircuitCanvasView['densityState'] {
  if (nodeCount === 0) return 'empty'
  if (nodeCount <= 10) return 'normal'
  if (nodeCount <= 25) return 'crowded'
  return 'overflow'
}

// ─── Viewport Management ─────────────────────────────────────────────────────

/**
 * Calculate fit-to-view transform
 */
export function calculateFitToView(
  nodes: CircuitNode[],
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number; scale: number } {
  if (nodes.length === 0) {
    return { x: 0, y: 0, scale: 1 }
  }

  // Find bounds
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  nodes.forEach((node) => {
    minX = Math.min(minX, node.position.x)
    maxX = Math.max(maxX, node.position.x + NODE_W)
    minY = Math.min(minY, node.position.y)
    maxY = Math.max(maxY, node.position.y + NODE_H)
  })

  const contentWidth = maxX - minX
  const contentHeight = maxY - minY

  if (contentWidth === 0 || contentHeight === 0) {
    return { x: 0, y: 0, scale: 1 }
  }

  // Calculate scale to fit
  const padding = 48
  const scaleX = (canvasWidth - padding * 2) / contentWidth
  const scaleY = (canvasHeight - padding * 2) / contentHeight
  const scale = Math.min(scaleX, scaleY, 1.5) // Max zoom 1.5x

  // Center the content
  const centerX = minX + contentWidth / 2
  const centerY = minY + contentHeight / 2
  const x = (canvasWidth / 2 - centerX * scale) / scale
  const y = (canvasHeight / 2 - centerY * scale) / scale

  return { x, y, scale }
}

// ─── Main Derivation Function ────────────────────────────────────────────────

/**
 * Derive circuit canvas view from runtime data
 */
export function deriveCircuitCanvasView(
  primeName: string,
  agents: RegistryAgent[],
  threads: RuntimeThread[],
  workItems: RuntimeWorkItem[],
  delegations: RuntimeDelegation[],
  auditLoops: RuntimeAuditLoop[],
  viewport: CanvasViewport = { x: 0, y: 0, scale: 1 },
): CircuitCanvasView {
  const { nodes, edges } = buildCircuitGraph(
    primeName,
    agents,
    threads,
    workItems,
    delegations,
    auditLoops,
  )

  const densityState = calculateDensityState(nodes.length)

  // Determine overall status
  let status: CircuitCanvasView['status'] = 'ready'
  if (nodes.length === 0) status = 'empty'
  else if (viewport.scale <= 0) status = 'error'

  return {
    viewport,
    nodes,
    edges,
    densityState,
    status,
  }
}
