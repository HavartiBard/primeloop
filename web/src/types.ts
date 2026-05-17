export interface AgentEvent {
  id: string
  agent: string
  type: string
  payload: Record<string, unknown>
  created_at: string
}

export interface Approval {
  approval_id: string
  run_id: string
  action: string
  status: 'pending' | 'approved' | 'denied'
  created_at: string
  decided_at?: string
}

export interface Provider {
  id: string
  name: string
  type: string
  base_url: string
  api_key?: string
  model?: string
  created_at: string
}

export interface RegistryAgent {
  id: string
  name: string
  type: string
  provider_id?: string
  runtime_family: string
  execution_mode: string
  endpoint?: string
  capabilities: string[]
  host?: string
  container_name?: string
  ssh_user?: string
  config: Record<string, unknown>
  enabled: boolean
  created_at: string
  local_port?: number
  worktree_path?: string
  system_prompt?: string
  soul?: string
  mcp_server_ids?: string[]
}

export interface MCPServer {
  id: string
  name: string
  description?: string
  type: 'http' | 'stdio'
  url?: string
  command?: string
  args?: string[]
  env_vars?: Record<string, string>
  created_at: string
}

export interface LifecycleResult {
  ok: boolean
  output: string
}

export interface AgentControlPlaneToken {
  agent_id: string
  token: string
  endpoint: string
  auth_scheme: 'Bearer'
}

export interface WorkItem {
  id: string
  title: string
  status: 'active' | 'blocked' | 'approval' | 'review' | 'deploy' | 'follow-up'
  owner: string
  lane: string
  updated_at: string
}

export interface StatusUpdate {
  id: string
  text: string
  created_at: string
}

export interface ChiefProfile {
  name: string
  persona: string
  policy: string
  preferences: string[]
  recurringDuties: string[]
  priorDecisions: string[]
}

export interface PermissionRule {
  scope: string
  mode: string
  note: string
}

export interface AuditLoop {
  id: string
  name: string
  cadence: string
  lastRun: string
  nextRun: string
  purpose: string
}

export interface PortalState {
  chief_profile: ChiefProfile
  work_items: WorkItem[]
  status_updates: StatusUpdate[]
  permission_rules: PermissionRule[]
  audit_loops: AuditLoop[]
  updated_at?: string
}

export interface RuntimeChiefProfile {
  id: string
  name: string
  persona: string
  operating_policy: string
  delegation_policy: Record<string, unknown>
  default_provider_id?: string
  created_at: string
  updated_at: string
}

export interface RuntimeThread {
  id: string
  title: string
  status: string
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ThreadMessage {
  id: string
  thread_id: string
  role: string
  sender: string
  content: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface RuntimeWorkItem {
  id: string
  title: string
  description?: string
  status: string
  priority: string
  lane: string
  owner_agent_id?: string
  owner_label: string
  thread_id?: string
  parent_id?: string
  blocked_by?: string
  due_at?: string
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface RuntimeDelegation {
  id: string
  work_item_id?: string
  from_agent_id?: string
  to_agent_id?: string
  status: string
  capability: string
  request: Record<string, unknown>
  result: Record<string, unknown>
  trace: unknown[]
  created_at: string
  updated_at: string
  completed_at?: string
}

export interface RuntimeMemory {
  id: string
  category: string
  content: string
  source_thread_id?: string
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface FleetPattern {
  id: string
  type: 'best_practice' | 'antipattern'
  content: string
  severity: string
  source_agent_id?: string
  source_agent_name?: string
  published_by?: string
  published_by_name?: string
  created_at: string
}

export interface FleetLearning {
  id: string
  kind: 'memory' | 'lesson'
  agent_id: string
  agent_name: string
  content: string
  category?: string
  tags?: string[]
  importance?: number
  severity?: string
  context?: string
  created_at: string
}

export interface AgentMemoryRecord {
  id: string
  agent_id: string
  content: string
  category?: string
  tags?: string[]
  importance: number
  created_at: string
}

export interface AgentLessonRecord {
  id: string
  agent_id: string
  content: string
  context?: string
  category?: string
  severity: string
  created_at: string
}

export interface LoopWarning {
  id: string
  agent_id: string
  kind: 'repeated-failure' | 'prompt-loop' | 'stall-retry' | 'approval-churn'
  severity: 'info' | 'warn' | 'error'
  summary: string
  evidence: Record<string, unknown>
  created_at: string
}

export interface FleetLoopWarning extends LoopWarning {
  agent_name: string
}

export interface LoopWarningDrilldownDelegation {
  id: string
  work_item_id?: string
  from_agent_id?: string
  to_agent_id?: string
  capability: string
  status: string
  request: Record<string, unknown>
  result: Record<string, unknown>
  created_at: string
  updated_at: string
  completed_at?: string
  from_agent_name?: string
  to_agent_name?: string
}

export interface LoopWarningDrilldownWorkItem {
  id: string
  title: string
  status: string
  priority: string
  lane: string
  owner_agent_id?: string
  owner_label: string
  blocked_by?: string
  updated_at: string
}

export interface LoopWarningDrilldown {
  warning: LoopWarning
  delegations: LoopWarningDrilldownDelegation[]
  work_items: LoopWarningDrilldownWorkItem[]
  approvals: Approval[]
  events: RuntimeEvent[]
}

export interface AgentSnapshot {
  id: string
  agent_id: string
  title: string
  summary?: string
  payload: Record<string, unknown>
  created_at: string
}

export interface FleetSnapshot extends AgentSnapshot {
  agent_name: string
}

export interface RuntimeAuditLoop {
  id: string
  name: string
  purpose: string
  cadence_cron: string
  enabled: boolean
  config: Record<string, unknown>
  last_run_at?: string
  next_run_at?: string
  created_at: string
  updated_at: string
}

export interface RuntimeEvent {
  id: string
  event_type: string
  actor: string
  thread_id?: string
  work_item_id?: string
  delegation_id?: string
  payload: Record<string, unknown>
  created_at: string
}

export interface RuntimeOverview {
  chief: RuntimeChiefProfile
  counts: Record<string, unknown>
  recent_events: RuntimeEvent[]
}

export interface ChiefRoute {
  capability: string
  lane: string
  priority: string
  status: string
  requiresApproval: boolean
  reason: string
}

export interface CodexAuthStatus {
  status: 'chatgpt' | 'api_key' | 'unauthenticated' | 'unknown'
  mode: string | null
  email: string | null
  raw: string
}

export interface CodexDeviceAuthResult {
  session_id: string
  url: string | null
  code: string | null
  already_authenticated?: boolean
}

export interface CodexDeviceAuthPoll {
  status: 'pending' | 'complete' | 'error'
  url?: string
  code?: string | null
  error?: string
}

export interface ChiefMessageResult {
  user_message: ThreadMessage
  chief_message: ThreadMessage
  work_item: RuntimeWorkItem
  delegation?: RuntimeDelegation
  selected_agent?: RegistryAgent
  route: ChiefRoute
}
