import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchAgentWorkspace,
  fetchAgentWorkspaceFile,
  fetchLoopWarningDrilldown,
  fetchFleetLoopWarnings,
  fetchFleetLearnings,
  fetchFleetPatterns,
  fetchPrimeModuleAudit,
  fetchPrimeModules,
  fetchFleetSnapshots,
  fetchRuntimeAuditLoops,
  fetchRuntimeMemory,
  fetchRuntimeOverview,
  publishFleetPattern,
  resolveApprovalAsPrime,
  saveAgentWorkspaceFile,
  updatePrimeModule,
  updateAgentWorkspace,
  initAgentWorkspace,
} from '../api'
import { useAgentRegistry } from '../hooks/useAgentRegistry'
import { useApprovals } from '../hooks/useApprovals'
import type { PermissionRule, PrimeModuleConfig, PrimeModuleConfigAudit, PrimeProfile } from '../types'

const DEFAULT_PROFILE: PrimeProfile = {
  name: 'Prime',
  persona: 'Pragmatic executive operations agent for homelab planning, delegation, and approvals.',
  policy: 'Keep work moving with bounded delegation, durable memory, scoped escalation, and concise status reporting.',
  preferences: [
    'Prefer direct execution over excessive planning.',
    'Route risky actions through explicit approval lanes.',
    'Surface blockers and stale work before opening new threads.',
  ],
  recurringDuties: [
    'Review open work hourly.',
    'Audit stale approvals and blocked tasks.',
    'Track PRs, reviews, deployments, and follow-ups through completion.',
  ],
  priorDecisions: [
    'Use a single persistent coordinator rather than stateless chat.',
    'Keep subagents specialist and bounded by scope.',
    'Preserve concise human-readable status updates in the portal.',
  ],
}

const DEFAULT_RULES: PermissionRule[] = [
  { scope: 'Filesystem writes', mode: 'Scoped', note: 'Allow within approved workspace roots only.' },
  { scope: 'Shell escalation', mode: 'Approval', note: 'Require explicit approval before unrestricted execution.' },
  { scope: 'GitHub/Gitea', mode: 'Delegated', note: 'Permit PR, review, and issue actions through tracked work items.' },
  { scope: 'Browser/docs/slides/sheets', mode: 'Open', note: 'Read-first unless a task requires edits or publication.' },
]

function cardClass(extra = '') {
  return `rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] shadow-[0_18px_48px_rgba(2,6,23,0.18)] backdrop-blur ${extra}`.trim()
}

function formatTime(value?: string) {
  return value ? new Date(value).toLocaleString() : 'Waiting'
}

function SectionHeader({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string
  title: string
  detail?: string
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <div className="text-[10px] font-medium uppercase tracking-[0.28em] text-[var(--muted)]">{eyebrow}</div>
        <h2 className="mt-1 text-lg font-semibold text-[var(--text)]">{title}</h2>
      </div>
      {detail ? (
        <div className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-1 text-[11px] text-[var(--muted)]">
          {detail}
        </div>
      ) : null}
    </div>
  )
}

function topLevelFolder(file: string): WorkspaceCategory {
  const [folder] = file.split('/', 1)
  switch (folder) {
    case 'prompts':
    case 'agents':
    case 'skills':
    case 'policies':
    case 'memory':
    case 'config':
      return folder
    default:
      return 'all'
  }
}

function inferWorkspaceScope(file: string): WorkspaceScope {
  if (file === 'agents/prime.md' || file.startsWith('prompts/prime/')) {
    return 'prime'
  }
  if (file.startsWith('agents/') || file.startsWith('prompts/agents/')) {
    return 'agents'
  }
  return 'shared'
}

type SettingsTab =
  | 'modules'
  | 'workspace'
  | 'governance'
  | 'approvals'
  | 'patterns'
  | 'memory'
  | 'audits'
  | 'loops'
  | 'learnings'
  | 'snapshots'

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'modules', label: 'Modules' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'governance', label: 'Governance' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'patterns', label: 'Patterns' },
  { id: 'memory', label: 'Memory' },
  { id: 'audits', label: 'Audits' },
  { id: 'loops', label: 'Loop Monitor' },
  { id: 'learnings', label: 'Learnings' },
  { id: 'snapshots', label: 'Snapshots' },
]

type WorkspaceScope = 'all' | 'prime' | 'agents' | 'shared'
type WorkspaceCategory = 'all' | 'prompts' | 'agents' | 'skills' | 'policies' | 'memory' | 'config'

const WORKSPACE_SCOPE_OPTIONS: Array<{ value: WorkspaceScope; label: string }> = [
  { value: 'all', label: 'All scopes' },
  { value: 'prime', label: 'Prime' },
  { value: 'agents', label: 'Agents' },
  { value: 'shared', label: 'Shared' },
]

const WORKSPACE_CATEGORY_OPTIONS: Array<{ value: WorkspaceCategory; label: string }> = [
  { value: 'all', label: 'All folders' },
  { value: 'prompts', label: 'Prompts' },
  { value: 'agents', label: 'Agents' },
  { value: 'skills', label: 'Skills' },
  { value: 'policies', label: 'Policies' },
  { value: 'memory', label: 'Memory' },
  { value: 'config', label: 'Config' },
]

export function Governance() {
  const queryClient = useQueryClient()
  const { approvals } = useApprovals()
  const { agents } = useAgentRegistry()
  const [activeTab, setActiveTab] = useState<SettingsTab>('workspace')
  const [selectedLoopWarning, setSelectedLoopWarning] = useState<{ agentId: string; warningId: string } | null>(null)
  const [selectedWorkspaceFile, setSelectedWorkspaceFile] = useState('prompts/prime/system.md')
  const [workspaceDraft, setWorkspaceDraft] = useState('')
  const [workspaceVersion, setWorkspaceVersion] = useState('')
  const [workspaceSaveError, setWorkspaceSaveError] = useState('')
  const [workspaceScope, setWorkspaceScope] = useState<WorkspaceScope>('all')
  const [workspaceCategory, setWorkspaceCategory] = useState<WorkspaceCategory>('all')
  const [workspaceSearch, setWorkspaceSearch] = useState('')
  const [workspaceSettings, setWorkspaceSettings] = useState({
    mode: 'local' as 'local' | 'git',
    root_path: '/var/lib/agent-cp/workspace',
    remote_url: '',
    branch: 'main',
  })
  const [patternDraft, setPatternDraft] = useState({
    type: 'best_practice',
    severity: 'info',
    content: '',
    source_agent_id: '',
  })
  const [modulePinnedVersions, setModulePinnedVersions] = useState<Record<string, string>>({})
  const [moduleConfigDrafts, setModuleConfigDrafts] = useState<Record<string, string>>({})
  const [moduleSaveErrors, setModuleSaveErrors] = useState<Record<string, string>>({})
  const [selectedModuleAuditId, setSelectedModuleAuditId] = useState<string | null>(null)
  const { data: runtimeOverview } = useQuery({
    queryKey: ['runtime-overview'],
    queryFn: fetchRuntimeOverview,
    refetchInterval: 15_000,
  })
  const { data: memories = [] } = useQuery({
    queryKey: ['runtime-memory'],
    queryFn: () => fetchRuntimeMemory(),
    refetchInterval: 30_000,
  })
  const { data: auditLoops = [] } = useQuery({
    queryKey: ['runtime-audit-loops'],
    queryFn: fetchRuntimeAuditLoops,
    refetchInterval: 30_000,
  })
  const { data: patterns = [] } = useQuery({
    queryKey: ['fleet-patterns'],
    queryFn: () => fetchFleetPatterns(),
    refetchInterval: 30_000,
  })
  const { data: learnings = [] } = useQuery({
    queryKey: ['fleet-learnings'],
    queryFn: () => fetchFleetLearnings({ limit: 12 }),
    refetchInterval: 30_000,
  })
  const { data: loopWarnings = [] } = useQuery({
    queryKey: ['fleet-loop-warnings'],
    queryFn: () => fetchFleetLoopWarnings({ limit: 12 }),
    refetchInterval: 30_000,
  })
  const { data: snapshots = [] } = useQuery({
    queryKey: ['fleet-snapshots'],
    queryFn: () => fetchFleetSnapshots({ limit: 8 }),
    refetchInterval: 30_000,
  })
  const { data: loopWarningDrilldown } = useQuery({
    queryKey: ['loop-warning-drilldown', selectedLoopWarning?.agentId, selectedLoopWarning?.warningId],
    queryFn: () => fetchLoopWarningDrilldown(selectedLoopWarning!.agentId, selectedLoopWarning!.warningId),
    enabled: Boolean(selectedLoopWarning),
    refetchInterval: 30_000,
  })
  const { data: workspace } = useQuery({
    queryKey: ['agent-workspace'],
    queryFn: fetchAgentWorkspace,
    refetchInterval: 30_000,
  })
  const { data: primeModules = [] } = useQuery({
    queryKey: ['prime-modules'],
    queryFn: fetchPrimeModules,
    refetchInterval: 30_000,
  })
  const { data: selectedModuleAudits = [] } = useQuery({
    queryKey: ['prime-module-audit', selectedModuleAuditId],
    queryFn: () => fetchPrimeModuleAudit(selectedModuleAuditId!, 12),
    enabled: Boolean(selectedModuleAuditId),
    refetchInterval: 30_000,
  })
  const { data: workspaceFile } = useQuery({
    queryKey: ['agent-workspace-file', selectedWorkspaceFile],
    queryFn: () => fetchAgentWorkspaceFile(selectedWorkspaceFile),
    enabled: Boolean(selectedWorkspaceFile),
  })
  const publishPatternMutation = useMutation({
    mutationFn: publishFleetPattern,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fleet-patterns'] })
      setPatternDraft((current) => ({ ...current, content: '' }))
    },
  })
  const resolveApprovalMutation = useMutation({
    mutationFn: ({ approvalId, decision }: { approvalId: string; decision: 'approved' | 'denied' }) =>
      resolveApprovalAsPrime(approvalId, decision),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['approvals'] })
      void queryClient.invalidateQueries({ queryKey: ['runtime-overview'] })
    },
  })
  const saveWorkspaceMutation = useMutation({
    mutationFn: ({ filePath, content, expectedVersion }: { filePath: string; content: string; expectedVersion?: string }) =>
      saveAgentWorkspaceFile(filePath, content, expectedVersion),
    onSuccess: async (savedFile) => {
      setWorkspaceVersion(savedFile.version)
      setWorkspaceSaveError('')
      await queryClient.invalidateQueries({ queryKey: ['agent-workspace'] })
      await queryClient.invalidateQueries({ queryKey: ['agent-workspace-file', selectedWorkspaceFile] })
    },
    onError: (error) => {
      setWorkspaceSaveError(error instanceof Error ? error.message : 'Failed to save workspace file')
    },
  })
  const initWorkspaceMutation = useMutation({
    mutationFn: initAgentWorkspace,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['agent-workspace'] })
      await queryClient.invalidateQueries({ queryKey: ['agent-workspace-file', selectedWorkspaceFile] })
    },
  })
  const updateWorkspaceMutation = useMutation({
    mutationFn: (data: { mode: 'local' | 'git'; root_path: string; remote_url?: string | null; branch: string }) =>
      updateAgentWorkspace(data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['agent-workspace'] })
    },
  })
  const updatePrimeModuleMutation = useMutation({
    mutationFn: ({
      moduleId,
      patch,
    }: {
      moduleId: string
      patch: Partial<Pick<PrimeModuleConfig, 'enabled' | 'rollout_mode' | 'config'>> & {
        pinned_version?: string | null
      }
    }) => updatePrimeModule(moduleId, patch),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['prime-modules'] })
    },
  })

  useEffect(() => {
    if (workspaceFile) {
      setWorkspaceDraft(workspaceFile.content)
      setWorkspaceVersion(workspaceFile.version)
      setWorkspaceSaveError('')
    }
  }, [workspaceFile])
  useEffect(() => {
    if (workspace) {
      setWorkspaceSettings({
        mode: workspace.mode,
        root_path: workspace.root_path,
        remote_url: workspace.remote_url ?? '',
        branch: workspace.branch,
      })
    }
  }, [workspace])

  const profile: PrimeProfile = useMemo(() => {
    const current = runtimeOverview?.prime
      ? {
          name: runtimeOverview.prime.name,
          persona: runtimeOverview.prime.persona,
          policy: runtimeOverview.prime.operating_policy,
          preferences: memories.filter((m) => m.category === 'preference').map((m) => m.content),
          recurringDuties: memories.filter((m) => m.category === 'recurring-duty').map((m) => m.content),
          priorDecisions: memories.filter((m) => m.category === 'prior-decision').map((m) => m.content),
        }
      : { ...DEFAULT_PROFILE, preferences: [], recurringDuties: [], priorDecisions: [] }

    if (current.preferences.length === 0) current.preferences = DEFAULT_PROFILE.preferences
    if (current.recurringDuties.length === 0) current.recurringDuties = DEFAULT_PROFILE.recurringDuties
    if (current.priorDecisions.length === 0) current.priorDecisions = DEFAULT_PROFILE.priorDecisions
    return current
  }, [memories, runtimeOverview?.prime])

  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending')
  const primeAgents = agents.filter((agent) => agent.capabilities.includes('prime'))
  const selectedWarningKey = selectedLoopWarning ? `${selectedLoopWarning.agentId}:${selectedLoopWarning.warningId}` : null
  const tabButtonClass = (tab: SettingsTab) =>
    `relative -mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
      activeTab === tab
        ? 'border-[var(--accent)] text-[var(--text)]'
        : 'border-transparent text-[var(--muted)] hover:border-[var(--border-soft)] hover:text-[var(--text)]'
    }`
  const workspaceFiles = workspace?.files ?? []
  const filteredWorkspaceFiles = useMemo(() => {
    return workspaceFiles.filter((file) => {
      if (workspaceCategory !== 'all' && topLevelFolder(file) !== workspaceCategory) {
        return false
      }
      if (workspaceScope !== 'all' && inferWorkspaceScope(file) !== workspaceScope) {
        return false
      }
      if (workspaceSearch.trim()) {
        const query = workspaceSearch.trim().toLowerCase()
        if (!file.toLowerCase().includes(query)) {
          return false
        }
      }
      return true
    })
  }, [workspaceCategory, workspaceFiles, workspaceScope, workspaceSearch])

  useEffect(() => {
    if (!filteredWorkspaceFiles.includes(selectedWorkspaceFile) && filteredWorkspaceFiles.length > 0) {
      setSelectedWorkspaceFile(filteredWorkspaceFiles[0])
    }
  }, [filteredWorkspaceFiles, selectedWorkspaceFile])

  useEffect(() => {
    setWorkspaceSaveError('')
  }, [selectedWorkspaceFile])

  useEffect(() => {
    setModulePinnedVersions(
      Object.fromEntries(primeModules.map((module) => [module.module_id, module.pinned_version ?? '']))
    )
    setModuleConfigDrafts(
      Object.fromEntries(
        primeModules.map((module) => [module.module_id, JSON.stringify(module.config ?? {}, null, 2)])
      )
    )
    setModuleSaveErrors({})
  }, [primeModules])

  function togglePrimeModule(module: PrimeModuleConfig) {
    updatePrimeModuleMutation.mutate({
      moduleId: module.module_id,
      patch: { enabled: !module.enabled },
    })
  }

  function changePrimeModuleRollout(module: PrimeModuleConfig, rolloutMode: PrimeModuleConfig['rollout_mode']) {
    updatePrimeModuleMutation.mutate({
      moduleId: module.module_id,
      patch: { rollout_mode: rolloutMode },
    })
  }

  function savePrimeModuleDetails(module: PrimeModuleConfig) {
    const pinnedVersion = modulePinnedVersions[module.module_id] ?? ''
    const configDraft = moduleConfigDrafts[module.module_id] ?? '{}'

    let parsedConfig: Record<string, unknown>
    try {
      const parsed = JSON.parse(configDraft) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Config JSON must be an object')
      }
      parsedConfig = parsed as Record<string, unknown>
    } catch (error) {
      setModuleSaveErrors((current) => ({
        ...current,
        [module.module_id]: error instanceof Error ? error.message : 'Invalid config JSON',
      }))
      return
    }

    setModuleSaveErrors((current) => ({ ...current, [module.module_id]: '' }))
    updatePrimeModuleMutation.mutate({
      moduleId: module.module_id,
      patch: {
        pinned_version: pinnedVersion.trim() || null,
        config: parsedConfig,
      },
    })
  }

  function formatAuditConfig(value: Record<string, unknown>): string {
    return JSON.stringify(value, null, 2)
  }

  function toggleModuleAudit(moduleId: string) {
    setSelectedModuleAuditId((current) => (current === moduleId ? null : moduleId))
  }

  return (
    <div className="min-h-screen px-4 py-4 sm:px-6 lg:px-8">
      <section className="space-y-5">
        <div className={cardClass('p-5 sm:p-6')}>
          <SectionHeader eyebrow="Settings" title="Control Plane Settings" detail={SETTINGS_TABS.find((tab) => tab.id === activeTab)?.label} />
          <div className="overflow-x-auto border-b border-[var(--border-soft)]">
            <div className="flex min-w-max gap-1">
              {SETTINGS_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={tabButtonClass(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {activeTab === 'modules' && (
          <div className={`${cardClass()} p-5 sm:p-6`}>
            <SectionHeader eyebrow="Prime" title="Module Registry" detail={`${primeModules.length} modules`} />
            <div className="space-y-3">
              {primeModules.map((module) => (
                <div key={module.module_id} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--text)]">{module.module_id}</div>
                      <div className="mt-1 text-xs text-[var(--muted)]">
                        {module.stage} · default {module.default_version}
                        {module.pinned_version ? ` · pinned ${module.pinned_version}` : ' · unpinned'}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className={`rounded-full border px-3 py-1 text-xs ${
                        module.enabled
                          ? 'border-emerald-300/20 bg-emerald-300/12 text-emerald-50'
                          : 'border-rose-300/20 bg-rose-300/12 text-rose-50'
                      }`}>
                        {module.enabled ? 'enabled' : 'disabled'}
                      </span>
                      <span className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-1 text-xs text-[var(--muted)]">
                        {module.rollout_mode}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-[auto_auto_1fr] lg:items-center">
                    <button
                      type="button"
                      onClick={() => togglePrimeModule(module)}
                      disabled={updatePrimeModuleMutation.isPending}
                      className="rounded-full border border-[var(--sel-bd)] bg-[var(--sel-bg)] px-4 py-1.5 text-xs text-blue-300 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {module.enabled ? 'Disable Module' : 'Enable Module'}
                    </button>
                    <select
                      value={module.rollout_mode}
                      onChange={(event) =>
                        changePrimeModuleRollout(module, event.target.value as PrimeModuleConfig['rollout_mode'])}
                      disabled={updatePrimeModuleMutation.isPending}
                      className="rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="active">active</option>
                      <option value="shadow">shadow</option>
                    </select>
                    <div className="text-xs text-[var(--muted)]">
                      Updated {formatTime(module.updated_at)}
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => toggleModuleAudit(module.module_id)}
                      className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-1.5 text-xs text-[var(--text)] transition hover:bg-[var(--panel-subtle)]"
                    >
                      {selectedModuleAuditId === module.module_id ? 'Hide Audit' : 'Show Audit'}
                    </button>
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_auto]">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Pinned Version</div>
                      <input
                        value={modulePinnedVersions[module.module_id] ?? ''}
                        onChange={(event) =>
                          setModulePinnedVersions((current) => ({
                            ...current,
                            [module.module_id]: event.target.value,
                          }))}
                        placeholder="leave blank for default"
                        className="mt-2 w-full rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
                      />
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Config JSON</div>
                      <textarea
                        value={moduleConfigDrafts[module.module_id] ?? '{}'}
                        onChange={(event) =>
                          setModuleConfigDrafts((current) => ({
                            ...current,
                            [module.module_id]: event.target.value,
                          }))}
                        rows={5}
                        className="mt-2 w-full rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 font-mono text-xs text-[var(--text)]"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => savePrimeModuleDetails(module)}
                        disabled={updatePrimeModuleMutation.isPending}
                        className="rounded-full border border-[var(--sel-bd)] bg-[var(--sel-bg)] px-4 py-1.5 text-xs text-blue-300 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Save Details
                      </button>
                    </div>
                  </div>
                  {moduleSaveErrors[module.module_id] && (
                    <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
                      {moduleSaveErrors[module.module_id]}
                    </div>
                  )}
                  {selectedModuleAuditId === module.module_id && (
                    <div className="mt-3 rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel)] p-3">
                      <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Audit History</div>
                      <div className="mt-3 space-y-3">
                        {selectedModuleAudits.map((audit: PrimeModuleConfigAudit) => (
                          <div key={audit.id} className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-sm font-medium text-[var(--text)]">{audit.actor}</div>
                              <div className="text-xs text-[var(--muted)]">{formatTime(audit.created_at)}</div>
                            </div>
                            <div className="mt-2 text-xs text-[var(--muted)]">
                              Changed: {audit.changed_fields.join(', ') || 'none'}
                            </div>
                            <div className="mt-3 grid gap-3 lg:grid-cols-2">
                              <div>
                                <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Previous</div>
                                <pre className="mt-2 overflow-x-auto rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 font-mono text-xs text-[var(--muted)]">
                                  {formatAuditConfig(audit.previous_config)}
                                </pre>
                              </div>
                              <div>
                                <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Next</div>
                                <pre className="mt-2 overflow-x-auto rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 font-mono text-xs text-[var(--muted)]">
                                  {formatAuditConfig(audit.next_config)}
                                </pre>
                              </div>
                            </div>
                          </div>
                        ))}
                        {selectedModuleAudits.length === 0 && (
                          <div className="text-xs text-[var(--muted)]">No audit records yet.</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {primeModules.length === 0 && (
                <div className="rounded-[1rem] border border-dashed border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4 text-sm text-[var(--muted)]">
                  No Prime modules discovered yet.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'governance' && (
          <div className={`${cardClass()} p-5 sm:p-6`}>
            <SectionHeader eyebrow="Controls" title="Governance" detail={`${DEFAULT_RULES.length} active rules`} />
            <div className="space-y-3">
              {DEFAULT_RULES.map((rule) => (
                <div key={rule.scope} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[var(--text)]">{rule.scope}</div>
                    <div className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-1 text-xs text-[var(--muted)]">{rule.mode}</div>
                  </div>
                  <div className="mt-2 text-sm text-[var(--text)]">{rule.note}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'workspace' && (
          <div className={`${cardClass()} p-5 sm:p-6`}>
            <SectionHeader
              eyebrow="Workspace"
              title="Agent Workspace"
              detail={workspace ? `${workspace.files.length} files` : 'loading'}
            />
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Mode</div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setWorkspaceSettings((current) => ({ ...current, mode: 'local' }))}
                      className={`rounded-full border px-3 py-1.5 text-xs transition ${
                        workspaceSettings.mode === 'local'
                          ? 'border-[var(--sel-bd)] bg-[var(--sel-bg)] text-blue-300'
                          : 'border-[var(--border-soft)] bg-[var(--panel)] text-[var(--muted)]'
                      }`}
                    >
                      Local
                    </button>
                    <button
                      type="button"
                      onClick={() => setWorkspaceSettings((current) => ({ ...current, mode: 'git' }))}
                      className={`rounded-full border px-3 py-1.5 text-xs transition ${
                        workspaceSettings.mode === 'git'
                          ? 'border-[var(--sel-bd)] bg-[var(--sel-bg)] text-blue-300'
                          : 'border-[var(--border-soft)] bg-[var(--panel)] text-[var(--muted)]'
                      }`}
                    >
                      Git
                    </button>
                  </div>
                </div>
                <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-4 py-3 text-xs text-[var(--muted)]">
                  <div>Status: <span className="text-[var(--text)]">{workspace?.sync_status ?? 'loading'}</span></div>
                  <div className="mt-1">Dirty: <span className="text-[var(--text)]">{workspace?.dirty ? 'yes' : 'no'}</span></div>
                  <div className="mt-1">Revision: <span className="text-[var(--text)]">{workspace?.last_commit?.slice(0, 12) ?? 'none'}</span></div>
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Workspace Root</div>
                <input
                  value={workspaceSettings.root_path}
                  onChange={(e) => setWorkspaceSettings((current) => ({ ...current, root_path: e.target.value }))}
                  className="mt-2 w-full rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
                />
              </div>
              {workspaceSettings.mode === 'git' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Remote URL</div>
                    <input
                      value={workspaceSettings.remote_url}
                      onChange={(e) => setWorkspaceSettings((current) => ({ ...current, remote_url: e.target.value }))}
                      className="mt-2 w-full rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
                    />
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Branch</div>
                    <input
                      value={workspaceSettings.branch}
                      onChange={(e) => setWorkspaceSettings((current) => ({ ...current, branch: e.target.value }))}
                      className="mt-2 w-full rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
                    />
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => updateWorkspaceMutation.mutate(workspaceSettings)}
                  disabled={updateWorkspaceMutation.isPending}
                  className="rounded-full border border-[var(--sel-bd)] bg-[var(--sel-bg)] px-4 py-1.5 text-xs text-blue-300 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Save Workspace Settings
                </button>
                <button
                  onClick={() => initWorkspaceMutation.mutate()}
                  disabled={initWorkspaceMutation.isPending}
                  className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-1.5 text-xs text-[var(--text)] transition hover:bg-[var(--panel-subtle)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Scaffold Files
                </button>
              </div>
              <div className="grid gap-3 rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3 lg:grid-cols-[180px_180px_minmax(0,1fr)]">
                <select
                  value={workspaceScope}
                  onChange={(e) => setWorkspaceScope(e.target.value as WorkspaceScope)}
                  className="rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
                >
                  {WORKSPACE_SCOPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <select
                  value={workspaceCategory}
                  onChange={(e) => setWorkspaceCategory(e.target.value as WorkspaceCategory)}
                  className="rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
                >
                  {WORKSPACE_CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <input
                  value={workspaceSearch}
                  onChange={(e) => setWorkspaceSearch(e.target.value)}
                  placeholder="Search files by path"
                  className="rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
                />
              </div>
              <div className="grid gap-4 xl:grid-cols-[0.42fr_0.58fr]">
                <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Files</div>
                    <div className="text-[11px] text-[var(--muted)]">{filteredWorkspaceFiles.length} shown</div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {filteredWorkspaceFiles.map((file) => (
                      <button
                        key={file}
                        type="button"
                        onClick={() => setSelectedWorkspaceFile(file)}
                        className={`block w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
                          selectedWorkspaceFile === file
                            ? 'border-[var(--sel-bd)] bg-[var(--sel-bg)] text-[var(--text)]'
                            : 'border-[var(--border-soft)] bg-[var(--panel)] text-[var(--muted)]'
                        }`}
                      >
                        {file}
                      </button>
                    ))}
                    {workspaceFiles.length === 0 && (
                      <div className="text-xs text-[var(--muted)]">No workspace files found yet.</div>
                    )}
                    {workspaceFiles.length > 0 && filteredWorkspaceFiles.length === 0 && (
                      <div className="text-xs text-[var(--muted)]">No files match the current filters.</div>
                    )}
                  </div>
                </div>
                <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                      {selectedWorkspaceFile}
                    </div>
                    <button
                      onClick={() => saveWorkspaceMutation.mutate({
                        filePath: selectedWorkspaceFile,
                        content: workspaceDraft,
                        expectedVersion: workspaceVersion,
                      })}
                      disabled={saveWorkspaceMutation.isPending || !selectedWorkspaceFile}
                      className="rounded-full border border-[var(--sel-bd)] bg-[var(--sel-bg)] px-3 py-1.5 text-[11px] text-blue-300 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Save File
                    </button>
                  </div>
                  {workspaceSaveError && (
                    <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
                      {workspaceSaveError}
                    </div>
                  )}
                  <textarea
                    value={workspaceDraft}
                    onChange={(e) => setWorkspaceDraft(e.target.value)}
                    rows={18}
                    className="mt-3 w-full rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 font-mono text-xs text-[var(--text)]"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'approvals' && (
          <div className={`${cardClass()} p-5 sm:p-6`}>
            <SectionHeader eyebrow="Approvals" title="Pending Escalations" detail={`${pendingApprovals.length} pending`} />
            <div className="space-y-3">
              {pendingApprovals.map((approval) => (
                <div key={approval.approval_id} className="rounded-[1rem] border border-amber-300/20 bg-amber-300/10 p-4">
                  <div className="text-sm font-medium text-[var(--text)]">{approval.action}</div>
                  <div className="mt-1 text-xs text-amber-50/70">Run {approval.run_id}</div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => resolveApprovalMutation.mutate({ approvalId: approval.approval_id, decision: 'approved' })}
                      disabled={resolveApprovalMutation.isPending}
                      className="rounded-full border border-emerald-300/20 bg-emerald-300/12 px-3 py-1.5 text-xs text-emerald-50 transition hover:bg-emerald-300/20"
                    >
                      Approve Via Prime
                    </button>
                    <button
                      onClick={() => resolveApprovalMutation.mutate({ approvalId: approval.approval_id, decision: 'denied' })}
                      disabled={resolveApprovalMutation.isPending}
                      className="rounded-full border border-rose-300/20 bg-rose-300/12 px-3 py-1.5 text-xs text-rose-50 transition hover:bg-rose-300/20"
                    >
                      Deny Via Prime
                    </button>
                  </div>
                </div>
              ))}
              {pendingApprovals.length === 0 && (
                <div className="rounded-[1rem] border border-dashed border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4 text-sm text-[var(--muted)]">
                  No pending approvals. Escalation lanes are currently clear.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'patterns' && (
          <div className={`${cardClass()} p-5 sm:p-6`}>
            <SectionHeader eyebrow="Fleet" title="Pattern Library" detail={`${patterns.length} patterns`} />
            <div className="mb-4 rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
              <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Publish Pattern</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <select
                  value={patternDraft.type}
                  onChange={(e) => setPatternDraft((current) => ({ ...current, type: e.target.value }))}
                  className="rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
                >
                  <option value="best_practice">Best practice</option>
                  <option value="antipattern">Antipattern</option>
                </select>
                <select
                  value={patternDraft.severity}
                  onChange={(e) => setPatternDraft((current) => ({ ...current, severity: e.target.value }))}
                  className="rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
                >
                  <option value="info">Info</option>
                  <option value="warn">Warn</option>
                  <option value="error">Error</option>
                </select>
              </div>
              <select
                value={patternDraft.source_agent_id}
                onChange={(e) => setPatternDraft((current) => ({ ...current, source_agent_id: e.target.value }))}
                className="mt-3 w-full rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
              >
                <option value="">Source agent: Prime default</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
              <textarea
                value={patternDraft.content}
                onChange={(e) => setPatternDraft((current) => ({ ...current, content: e.target.value }))}
                rows={4}
                placeholder="Capture a reusable best practice or antipattern for the fleet."
                className="mt-3 w-full rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="text-xs text-[var(--muted)]">
                  {primeAgents.length > 0 ? `${primeAgents.length} prime-capable agent${primeAgents.length === 1 ? '' : 's'} available` : 'No prime-capable agent registered'}
                </div>
                <button
                  onClick={() => publishPatternMutation.mutate({
                    type: patternDraft.type as 'best_practice' | 'antipattern',
                    severity: patternDraft.severity,
                    content: patternDraft.content,
                    ...(patternDraft.source_agent_id ? { source_agent_id: patternDraft.source_agent_id } : {}),
                  })}
                  disabled={publishPatternMutation.isPending || !patternDraft.content.trim() || primeAgents.length === 0}
                  className="rounded-full border border-[var(--sel-bd)] bg-[var(--sel-bg)] px-4 py-1.5 text-xs text-blue-300 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Publish Pattern
                </button>
              </div>
            </div>
            <div className="space-y-3">
              {patterns.slice(0, 8).map((pattern) => (
                <div key={pattern.id} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[var(--text)]">
                      {pattern.type === 'antipattern' ? 'Antipattern' : 'Best Practice'}
                    </div>
                    <div className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-1 text-xs text-[var(--muted)]">
                      {pattern.severity}
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-[var(--text)]">{pattern.content}</div>
                  <div className="mt-2 text-xs text-[var(--muted)]">
                    {pattern.source_agent_name ? `Source ${pattern.source_agent_name}` : 'Fleet pattern'}
                  </div>
                </div>
              ))}
              {patterns.length === 0 && (
                <div className="rounded-[1rem] border border-dashed border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4 text-sm text-[var(--muted)]">
                  No published patterns yet.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'memory' && (
          <div className={`${cardClass()} p-5 sm:p-6`}>
            <SectionHeader eyebrow="Context" title="Persistent Memory" detail={`${profile.preferences.length + profile.recurringDuties.length + profile.priorDecisions.length} entries`} />
            <div className="space-y-4">
              <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Preferences</div>
                <div className="mt-2 space-y-2 text-sm text-[var(--text)]">
                  {profile.preferences.map((item) => <div key={item}>{item}</div>)}
                </div>
              </div>
              <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Recurring Duties</div>
                <div className="mt-2 space-y-2 text-sm text-[var(--text)]">
                  {profile.recurringDuties.map((item) => <div key={item}>{item}</div>)}
                </div>
              </div>
              <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Prior Decisions</div>
                <div className="mt-2 space-y-2 text-sm text-[var(--text)]">
                  {profile.priorDecisions.map((item) => <div key={item}>{item}</div>)}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'audits' && (
          <div className={`${cardClass()} p-5 sm:p-6`}>
            <SectionHeader eyebrow="Background" title="Audit Loops" detail={`${auditLoops.length} loops`} />
            <div className="space-y-3">
              {auditLoops.map((loop) => (
                <div key={loop.id} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[var(--text)]">{loop.name}</div>
                    <div className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-1 text-xs text-[var(--muted)]">{loop.cadence_cron}</div>
                  </div>
                  <div className="mt-2 text-sm text-[var(--text)]">{loop.purpose}</div>
                  <div className="mt-3 grid gap-2 text-xs text-[var(--muted)] sm:grid-cols-2">
                    <div>Last run: {formatTime(loop.last_run_at)}</div>
                    <div>Next run: {formatTime(loop.next_run_at)}</div>
                  </div>
                </div>
              ))}
              {auditLoops.length === 0 && (
                <div className="rounded-[1rem] border border-dashed border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4 text-sm text-[var(--muted)]">
                  No audit loops are configured yet.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'loops' && (
          <div className={`${cardClass()} p-5 sm:p-6`}>
            <SectionHeader eyebrow="Fleet" title="Loop Monitor" detail={`${loopWarnings.length} warnings`} />
            <div className="space-y-3">
              {loopWarnings.map((warning, index) => (
                <div key={`${warning.kind}:${warning.created_at}:${index}`} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[var(--text)]">{warning.summary}</div>
                    <div className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-1 text-xs text-[var(--muted)]">
                      {warning.severity}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-[var(--muted)]">{warning.agent_name} · {warning.kind}</div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="text-xs text-[var(--muted)]">{formatTime(warning.created_at)}</div>
                    <button
                      onClick={() => setSelectedLoopWarning((current) =>
                        current?.agentId === warning.agent_id && current.warningId === warning.id
                          ? null
                          : { agentId: warning.agent_id, warningId: warning.id })}
                      className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-1.5 text-xs text-[var(--text)] transition hover:bg-[var(--panel-subtle)]"
                    >
                      {selectedWarningKey === `${warning.agent_id}:${warning.id}` ? 'Hide Lineage' : 'Inspect Lineage'}
                    </button>
                  </div>
                  {selectedWarningKey === `${warning.agent_id}:${warning.id}` && loopWarningDrilldown ? (
                    <div className="mt-4 space-y-3 rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel)] p-4">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Delegations</div>
                        <div className="mt-2 space-y-2">
                          {loopWarningDrilldown.delegations.map((delegation) => (
                            <div key={delegation.id} className="rounded-[0.9rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-medium text-[var(--text)]">{delegation.capability}</div>
                                <div className="rounded-full border border-[var(--border-soft)] px-2 py-0.5 text-[11px] text-[var(--muted)]">{delegation.status}</div>
                              </div>
                              <div className="mt-1 text-xs text-[var(--muted)]">
                                {(delegation.from_agent_name ?? delegation.from_agent_id ?? 'unknown')} {'->'} {(delegation.to_agent_name ?? delegation.to_agent_id ?? 'unknown')}
                              </div>
                              <div className="mt-2 text-xs text-[var(--muted)]">
                                {typeof delegation.request.content === 'string'
                                  ? delegation.request.content
                                  : typeof delegation.request.prompt === 'string'
                                    ? delegation.request.prompt
                                    : `Delegation ${delegation.id}`}
                              </div>
                            </div>
                          ))}
                          {loopWarningDrilldown.delegations.length === 0 && (
                            <div className="text-xs text-[var(--muted)]">No delegation lineage resolved.</div>
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Work Items</div>
                        <div className="mt-2 space-y-2">
                          {loopWarningDrilldown.work_items.map((item) => (
                            <div key={item.id} className="rounded-[0.9rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-medium text-[var(--text)]">{item.title}</div>
                                <div className="rounded-full border border-[var(--border-soft)] px-2 py-0.5 text-[11px] text-[var(--muted)]">{item.status}</div>
                              </div>
                              <div className="mt-1 text-xs text-[var(--muted)]">{item.lane} · {item.priority} · owner {item.owner_label}</div>
                              {item.blocked_by && <div className="mt-1 text-xs text-[var(--muted)]">Blocked by {item.blocked_by}</div>}
                            </div>
                          ))}
                          {loopWarningDrilldown.work_items.length === 0 && (
                            <div className="text-xs text-[var(--muted)]">No work items attached to this warning.</div>
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Approvals</div>
                        <div className="mt-2 space-y-2">
                          {loopWarningDrilldown.approvals.map((approval) => (
                            <div key={approval.approval_id} className="rounded-[0.9rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-medium text-[var(--text)]">{approval.action}</div>
                                <div className="rounded-full border border-[var(--border-soft)] px-2 py-0.5 text-[11px] text-[var(--muted)]">{approval.status}</div>
                              </div>
                              <div className="mt-1 text-xs text-[var(--muted)]">Run {approval.run_id} · {formatTime(approval.created_at)}</div>
                            </div>
                          ))}
                          {loopWarningDrilldown.approvals.length === 0 && (
                            <div className="text-xs text-[var(--muted)]">No approval churn attached to this warning.</div>
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Recent Runtime Events</div>
                        <div className="mt-2 space-y-2">
                          {loopWarningDrilldown.events.map((event) => (
                            <div key={event.id} className="rounded-[0.9rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-medium text-[var(--text)]">{event.event_type}</div>
                                <div className="text-[11px] text-[var(--muted)]">{formatTime(event.created_at)}</div>
                              </div>
                              <div className="mt-1 text-xs text-[var(--muted)]">Actor {event.actor}</div>
                              {event.delegation_id && <div className="mt-1 text-xs text-[var(--muted)]">Delegation {event.delegation_id}</div>}
                              {event.work_item_id && <div className="mt-1 text-xs text-[var(--muted)]">Work item {event.work_item_id}</div>}
                            </div>
                          ))}
                          {loopWarningDrilldown.events.length === 0 && (
                            <div className="text-xs text-[var(--muted)]">No runtime events captured for this warning.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
              {loopWarnings.length === 0 && (
                <div className="rounded-[1rem] border border-dashed border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4 text-sm text-[var(--muted)]">
                  No loop warnings detected yet.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'learnings' && (
          <div className={`${cardClass()} p-5 sm:p-6`}>
            <SectionHeader eyebrow="Fleet" title="Recent Learnings" detail={`${learnings.length} entries`} />
            <div className="space-y-3">
              {learnings.map((entry) => (
                <div key={`${entry.kind}:${entry.id}`} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[var(--text)]">
                      {entry.agent_name} · {entry.kind}
                    </div>
                    <div className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-1 text-xs text-[var(--muted)]">
                      {entry.category ?? 'general'}
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-[var(--text)]">{entry.content}</div>
                  <div className="mt-2 text-xs text-[var(--muted)]">
                    {entry.kind === 'lesson'
                      ? (entry.context ? `Context: ${entry.context}` : entry.severity ?? 'lesson')
                      : (entry.importance != null ? `Importance ${entry.importance}` : 'memory')}
                  </div>
                  <div className="mt-3">
                    <button
                      onClick={() => setPatternDraft({
                        type: entry.kind === 'lesson' && entry.severity === 'error' ? 'antipattern' : 'best_practice',
                        severity: entry.kind === 'lesson' ? (entry.severity ?? 'info') : (entry.importance != null && entry.importance >= 4 ? 'warn' : 'info'),
                        content: entry.content,
                        source_agent_id: entry.agent_id,
                      })}
                      className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-1.5 text-xs text-[var(--text)] transition hover:bg-[var(--panel-subtle)]"
                    >
                      Seed Pattern Draft
                    </button>
                  </div>
                </div>
              ))}
              {learnings.length === 0 && (
                <div className="rounded-[1rem] border border-dashed border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4 text-sm text-[var(--muted)]">
                  No fleet learnings logged yet.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'snapshots' && (
          <div className={`${cardClass()} p-5 sm:p-6`}>
            <SectionHeader eyebrow="Recovery" title="Recent Snapshots" detail={`${snapshots.length} snapshots`} />
            <div className="space-y-3">
              {snapshots.map((snapshot) => (
                <div key={snapshot.id} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                  <div className="text-sm font-semibold text-[var(--text)]">{snapshot.title}</div>
                  {snapshot.summary && <div className="mt-2 text-sm text-[var(--text)]">{snapshot.summary}</div>}
                  <div className="mt-2 text-xs text-[var(--muted)]">{snapshot.agent_name} · {formatTime(snapshot.created_at)}</div>
                </div>
              ))}
              {snapshots.length === 0 && (
                <div className="rounded-[1rem] border border-dashed border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4 text-sm text-[var(--muted)]">
                  No snapshots created yet.
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
