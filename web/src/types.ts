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
  timeout_ms?: number
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
  status: 'active' | 'blocked' | 'approval' | 'review' | 'deploy' | 'follow-up' | 'done'
  owner: string
  lane: string
  updated_at: string
}

export interface StatusUpdate {
  id: string
  text: string
  created_at: string
}

export interface PrimeProfile {
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
  chief_profile: PrimeProfile
  work_items: WorkItem[]
  status_updates: StatusUpdate[]
  permission_rules: PermissionRule[]
  audit_loops: AuditLoop[]
  updated_at?: string
}

export interface RuntimePrimeProfile {
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

export interface PrimeSession {
  id: string
  trigger_type: string
  trigger_payload: Record<string, unknown>
  module_name?: string
  workspace_root?: string
  workspace_revision?: string
  prompt_templates: Record<string, string>
  reasoning_summary?: string
  actions_taken: unknown[]
  token_count: number
  provider_used?: string
  model_used?: string
  status: 'running' | 'completed' | 'failed' | 'escalated'
  error?: string
  started_at: string
  completed_at?: string
  last_step?: string
  module_runs?: PrimeSessionModuleRun[]
}

export interface PrimeSessionModuleRun {
  id: string
  session_id: string
  run_index: number
  module_id: string
  stage: string
  version: string
  mode?: 'active' | 'shadow'
  status: 'completed' | 'failed'
  detail?: string
  started_at: string
  completed_at: string
}

// ─── Prime Config & Model Preferences ─────────────────────────────────────

export interface ModelRouteEntry {
  provider_id: string
  model: string
}

export interface FunctionModelPreference {
  primary: ModelRouteEntry
  fallbacks: ModelRouteEntry[]
}

export type ModelPreferences = Record<string, FunctionModelPreference>

export const PRIME_MODEL_FUNCTION_TYPES = ['planning', 'routing', 'context', 'policy'] as const
export type PrimeModelFunctionType = typeof PRIME_MODEL_FUNCTION_TYPES[number]

export interface PrimeConfig {
  id: string
  enabled: boolean
  cron_fast_interval_seconds: number
  cron_slow_interval_seconds: number
  debounce_window_ms: number
  provider_routing: Record<string, ModelRouteEntry[]>
  cost_controls: Record<string, unknown>
  git_store: Record<string, unknown>
  model_preferences: ModelPreferences
  status: string
  last_started_at?: string
  last_error?: string
  created_at: string
  updated_at: string
}

export interface PrimeConfigPatch {
  enabled?: boolean
  cron_fast_interval_seconds?: number
  cron_slow_interval_seconds?: number
  debounce_window_ms?: number
  model_preferences?: ModelPreferences
  status?: string
  last_started_at?: string | null
  last_error?: string | null
}

export interface PrimeModuleConfig {
  module_id: string
  stage: string
  default_version: string
  pinned_version?: string
  enabled: boolean
  rollout_mode: 'active' | 'shadow'
  config: Record<string, unknown>
  created_at: string
  updated_at: string
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
  prime: RuntimePrimeProfile
  counts: Record<string, unknown>
  recent_events: RuntimeEvent[]
}

export interface AgentWorkspaceStatus {
  id: string
  mode: 'local' | 'git'
  root_path: string
  remote_url?: string
  branch: string
  sync_status: string
  last_sync_at?: string
  last_commit?: string
  dirty: boolean
  exists: boolean
  effective_root: string
  files: string[]
  created_at: string
  updated_at: string
}

export interface AgentWorkspaceFile {
  path: string
  content: string
  version: string
  updated_at: string
}

export interface PrimeRoute {
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

export interface PrimeMessageResult {
  user_message: ThreadMessage
  prime_message?: ThreadMessage
  work_item?: RuntimeWorkItem
  delegation?: RuntimeDelegation
  selected_agent?: RegistryAgent
  route: PrimeRoute
}

export type ModelTier = 'recommended' | 'warned' | 'blocked'

export interface ModelCapabilityAssessment {
  model: string
  estimatedParams: number | null
  jsonMode: boolean
  tier: ModelTier
  warning: string
  isBlocked: boolean
}

export interface PrimeProfileSoul {
  identity: string
  voice_tone: string
  decision_style: string
}

export interface PrimeProfileOperating {
  default_behaviors: string
  approval_thresholds: string
}

export type PrimeSectionKey =
  | 'identity' | 'voice_tone' | 'decision_style'
  | 'default_behaviors' | 'approval_thresholds'

// ─── Prime Onboarding Configuration (spec 018) ───────────────────────────────

/** Provider readiness status for onboarding. */
export type ProviderReadiness = 'idle' | 'verifying' | 'verified' | 'failed' | 'skipped' | 'unavailable'

/** Prime function keys for onboarding assignments. */
export type PrimeOnboardingFunctionKey =
  | 'orchestration'
  | 'planning'
  | 'coding_execution'
  | 'review_validation'
  | 'platform_maintenance'

/** Function assignment for onboarding. */
export interface FunctionAssignment {
  function_key: PrimeOnboardingFunctionKey | string
  display_name: string
  purpose: string
  required: boolean
  provider_id: string | null
  provider_name?: string
  model: string | null
  validation_status: 'missing' | 'valid' | 'warning' | 'blocked'
  warnings: string[]
  is_default_choice: boolean
  fallbacks?: Array<{ provider_id: string; model: string }>
}

/** Plugin info for inventory display (API response). */
export interface PluginInfo {
  id: string
  name: string
  description: string
  optional: boolean
  status: 'available' | 'unavailable'
}

/** Plugin choice for onboarding (internal state in setup draft). */
export interface PluginChoice {
  plugin_id: string
  name: string
  description: string
  availability: 'available' | 'unavailable' | 'unknown'
  selected: boolean
  configuration_state: 'not_required' | 'deferred_post_launch' | 'configured' | 'unavailable'
  post_launch_configuration_required: boolean
}

/** Agent entry in a team plan. */
export interface TeamPlanAgent {
  role: string
  name: string
  rationale: string
  recommendation_strength: 'strongly_recommended' | 'optional'
  category: 'platform_maintenance' | 'goal_specific'
  capabilities: string[]
}

/** Team plan for onboarding. */
export interface TeamPlan {
  id: string
  purpose: string
  confirmation_status: 'proposed' | 'confirmed' | 'rejected' | 'partially_confirmed'
  agents: TeamPlanAgent[]
  created_agent_ids: string[]
}

/** Launch readiness result for onboarding. */
export interface LaunchReadinessResult {
  ready: boolean
  overall_status?: 'ready' | 'warning' | 'blocked'
  required_missing?: number
  blocked?: number
  blocking_reasons: string[]
  warnings?: string[]
  warning_messages?: string[]
  assignments?: FunctionAssignment[]
  summary?: {
    providers: number
    required_functions: number
    selected_plugins: number
    assigned_required_functions?: number
  }
}

/** Prime configuration draft for onboarding. */
export interface PrimeConfigDraft {
  enabled?: boolean
  cron_fast_interval_seconds?: number
  cron_slow_interval_seconds?: number
  debounce_window_ms?: number
  monthly_token_budget?: number
  cost_controls?: Record<string, unknown>
  workspace?: {
    mode: 'local' | 'git'
    root_path?: string
    remote_url?: string | null
    branch?: string
  }
}

/** Provider draft for onboarding (masked credentials). */
export interface ProviderDraft {
  id: string
  name: string
  type: string
  base_url: string
  masked_credential_state: 'absent' | 'present' | 'needs_replacement' | 'not_required'
  connection_status: 'idle' | 'verifying' | 'verified' | 'failed' | 'skipped' | 'unavailable'
  available_models?: string[]
  verification_error?: string | null
}

/** Setup draft for onboarding (full state). */
export interface SetupDraft {
  providers: ProviderDraft[]
  function_assignments: FunctionAssignment[]
  prime_config_draft: PrimeConfigDraft
  plugin_choices: PluginChoice[]
  team_plan?: TeamPlan | null
  current_step: 'intro' | 'providers' | 'function_assignment' | 'prime_config' | 'plugins' | 'workspace' | 'launch' | 'prime_conversation' | 'complete'
  status: 'not_started' | 'in_progress' | 'blocked' | 'ready_to_launch' | 'launching' | 'launched' | 'complete'
  last_error?: string
}

/** Setup draft update payload for PUT /api/setup/draft. */
export interface SetupDraftUpdate {
  providers?: ProviderDraft[]
  function_assignments?: FunctionAssignment[]
  prime_config_draft?: PrimeConfigDraft
  plugin_choices?: PluginChoice[]
  team_plan?: TeamPlan
  current_step?: SetupDraft['current_step']
  status?: SetupDraft['status']
}

/** Team plan confirmation request. */
export interface TeamPlanConfirmRequest {
  selected_roles: string[]
  confirm: boolean
}

/** Team plan confirmation response. */
export interface TeamPlanConfirmResponse {
  team_plan: TeamPlan
}

export interface PrimeProfileResponse {
  name: string
  soul: PrimeProfileSoul
  operating: PrimeProfileOperating
  defaults_match: Record<PrimeSectionKey, boolean>
  shipped_defaults: Record<PrimeSectionKey, string>
}

// ─────────────────────────────────────────────────────────────────────────────
// Expanded Canvas UX Display Types (spec 017)
// ─────────────────────────────────────────────────────────────────────────────

/** Chat event kinds for the expanded timeline */
export type ChatEventKind =
  | 'message'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'context_attachment'
  | 'approval'
  | 'delegation'
  | 'goal'
  | 'artifact'
  | 'note'
  | 'system'

/** Status for chat display events and canvas nodes */
export type DisplayStatus =
  | 'pending'
  | 'streaming'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'timeout'
  | 'blocked'
  | 'resolved'
  | 'unavailable'

/** Source reference for a chat display event */
export interface EventSource {
  type: 'thread_message' | 'prime_session' | 'work_item' | 'delegation' | 'approval' | 'runtime_event'
  id: string
}

/** Context attachment reference */
export interface ContextAttachment {
  id: string
  name: string
  type: 'file' | 'artifact' | 'goal' | 'work_item' | 'message' | 'tool_result' | 'note' | 'link' | 'other'
  sourceLabel: string
  availability: 'available' | 'restricted' | 'deleted' | 'too_large' | 'loading' | 'error'
  previewSummary?: string
  targetRef?: {
    type: string
    id: string
  }
}

/** User action available on a display event */
export interface UserAction {
  label: string
  type: 'approve' | 'deny' | 'retry' | 'cancel' | 'expand' | 'open' | 'copy'
  handler?: () => void
}

/** Chat display event - normalized display item for the expanded chat timeline */
export interface ChatDisplayEvent {
  id: string
  kind: ChatEventKind
  actorLabel: string
  status: DisplayStatus
  occurredAt: string
  summary: string
  details?: string
  source: EventSource
  attachments: ContextAttachment[]
  actions?: UserAction[]
}

/** Approval display card - actionable display of an approval request */
export interface ApprovalDisplayCard {
  id: string
  requesterLabel: string
  requestSummary: string
  rationale?: string
  urgency?: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired'
  decisionOptions?: string[]
  decidedBy?: string
  decidedAt?: string
}

/** Delegation display card - display delegated or assigned work */
export interface DelegationDisplayCard {
  id: string
  sourceLabel: string
  targetLabel: string
  objective: string
  status: 'pending' | 'queued' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled'
  resultSummary?: string
  relatedWorkRef?: {
    type: string
    id: string
  }
}

/** Circuit node type */
export type CircuitNodeType =
  | 'prime'
  | 'agent'
  | 'room'
  | 'work_item'
  | 'approval'
  | 'delegation'
  | 'artifact'
  | 'note'
  | 'system'

/** Circuit node status category */
export type CircuitNodeStatus =
  | 'active'
  | 'running'
  | 'blocked'
  | 'approval'
  | 'neutral'
  | 'system'

/** Circuit node - spatial card or node representing an ACP object */
export interface CircuitNode {
  id: string
  type: CircuitNodeType
  title: string
  summary: string
  status: CircuitNodeStatus
  position: { x: number; y: number }
  collapsedDetails: string[]
  expandedDetails?: {
    participants?: string[]
    currentActivity?: string
    recentOutputs?: string[]
    pendingApprovals?: number
    context?: string[]
  }
  relatedRefs?: {
    type: string
    id: string
  }[]
}

/** Circuit edge - visible relationship between circuit nodes */
export interface CircuitEdge {
  id: string
  fromNodeId: string
  toNodeId: string
  relationship:
    | 'coordinates'
    | 'participates'
    | 'owns'
    | 'delegates'
    | 'requests_approval'
    | 'produces'
    | 'references'
  status?: CircuitNodeStatus
}

/** Canvas viewport state */
export interface CanvasViewport {
  x: number
  y: number
  scale: number
  selectedNodeId?: string
}

/** Circuit canvas view - spatial operating picture */
export interface CircuitCanvasView {
  viewport: CanvasViewport
  nodes: CircuitNode[]
  edges: CircuitEdge[]
  densityState: 'empty' | 'normal' | 'crowded' | 'overflow'
  status: 'loading' | 'ready' | 'error' | 'empty'
}

/** Toolbar action type */
export type ToolbarActionType =
  | 'spawn_agent'
  | 'tool_call'
  | 'create_goal'
  | 'capture_artifact'
  | 'add_note'

/** Toolbar draft action - context-preserving operator action */
export interface ToolbarDraftAction {
  id: string
  actionType: ToolbarActionType
  originContext: {
    activeRoomId?: string
    selectedWorkItemId?: string
    selectedNodeId?: string
  }
  requiredInputs: Record<string, unknown>
  status: 'draft' | 'submitting' | 'succeeded' | 'failed' | 'cancelled'
  createdRef?: {
    type: string
    id: string
  }
  errorSummary?: string
}

/** Toolbar action result - linked result in chat/canvas */
export interface ToolbarActionResult {
  draftId: string
  success: boolean
  createdRef?: {
    type: string
    id: string
  }
  errorSummary?: string
}
