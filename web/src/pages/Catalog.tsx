import { useState } from 'react'
import { RefreshCw, CheckCircle, XCircle, PlusCircle, ChevronDown, ChevronRight, Zap, RotateCcw, Trash2, Upload } from 'lucide-react'
import {
  useTemplates,
  useTemplate,
  useCatalogSources,
  useSyncCatalog,
  useApproveVersion,
  useValidateVersion,
  useInstantiateVersion,
  useRollbackTemplate,
  useDeprecateTemplate,
  useMigrate,
  useCreateCatalogSource,
} from '../hooks/useCatalog'
import type { CatalogTemplateSummary } from '../api'
import type { CatalogTemplateVersionSnapshot, FailureReason } from '../types/catalog'

type TabId = 'templates' | 'sources'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'templates', label: 'Templates' },
  { id: 'sources', label: 'Sources' },
]

// ── Admission state badge ─────────────────────────────────────────────────────

const STATE_STYLES: Record<string, string> = {
  discovered:       'bg-sky-400/10 text-sky-300 border-sky-400/30',
  validated:        'bg-emerald-400/10 text-emerald-300 border-emerald-400/30',
  pending_approval: 'bg-amber-400/10 text-amber-300 border-amber-400/30',
  registered:       'bg-[#1f6feb]/20 text-[#6ee7ff] border-[#1f6feb]/40',
  active:           'bg-emerald-400/10 text-emerald-400 border-emerald-400/30',
  rejected:         'bg-rose-400/10 text-rose-400 border-rose-400/30',
  deprecated:       'bg-[var(--panel-subtle)] text-[var(--muted)] border-[var(--border-soft)] opacity-60',
}

function AdmissionBadge({ state }: { state: string }) {
  const cls = STATE_STYLES[state] ?? 'bg-[var(--panel-subtle)] text-[var(--muted)] border-[var(--border-soft)]'
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}>
      {state.replace(/_/g, ' ')}
    </span>
  )
}

function LifecycleBadge({ state }: { state: string }) {
  const deprecated = state === 'deprecated'
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${deprecated ? 'bg-rose-400/10 text-rose-400' : 'bg-[var(--panel-subtle)] text-[var(--muted)]'}`}>
      {state}
    </span>
  )
}

// ── Failure reasons list ─────────────────────────────────────────────────────

const FAILURE_LABELS: Record<string, string> = {
  MISSING_REQUIRED_FIELD:    'Missing required field',
  INVALID_FIELD_TYPE:        'Invalid field type',
  UNKNOWN_RUNTIME_FAMILY:    'Unknown runtime family',
  UNKNOWN_CAPABILITY_BUNDLE: 'Unknown capability bundle',
  UNKNOWN_PLATFORM_PRIMITIVE:'Unknown platform primitive',
  UNKNOWN_MCP_SERVER:        'Unknown MCP server',
  UNKNOWN_CREDENTIAL:        'Unknown credential',
  UNKNOWN_PROVIDER:          'Unknown provider',
  LEAST_PRIVILEGE_VIOLATION: 'Least privilege violation',
  DUPLICATE_TEMPLATE_ID:     'Duplicate template ID',
  VERSION_CONFLICT:          'Version conflict',
  SECRET_VALUE_PRESENT:      'Potential secret detected',
  APPROVAL_POLICY_DOWNGRADED:'Approval policy downgraded',
}

function FailureList({ reasons }: { reasons: FailureReason[] }) {
  if (reasons.length === 0) return null
  return (
    <div className="mt-3 space-y-1.5">
      {reasons.map((r, i) => (
        <div key={i} className="rounded border border-rose-400/20 bg-rose-400/5 px-3 py-2 text-xs">
          <span className="font-medium text-rose-300">{FAILURE_LABELS[r.code] ?? r.code}</span>
          {r.field && <span className="ml-1.5 font-mono text-rose-400/70">{r.field}</span>}
          {r.detail && <p className="mt-0.5 text-rose-300/60">{r.detail}</p>}
        </div>
      ))}
    </div>
  )
}

// ── Version row ──────────────────────────────────────────────────────────────

interface VersionRowProps {
  v: CatalogTemplateVersionSnapshot
  templateId: string
  currentVersionId?: string
  onApprove: (version: string) => void
  onValidate: (version: string) => void
  onInstantiate: (version: string) => void
  onRollback: (version: string) => void
  isPending: boolean
}

function VersionRow({ v, templateId: _tid, currentVersionId, onApprove, onValidate, onInstantiate, onRollback, isPending }: VersionRowProps) {
  const [expanded, setExpanded] = useState(false)
  const isCurrent = v.id === currentVersionId
  const hasFailures = v.failureReasons?.length > 0

  return (
    <div className="rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)]">
      <div
        className="flex cursor-pointer items-center gap-2 px-3 py-2.5 hover:bg-[var(--panel)]"
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="text-[var(--muted)]">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
        <span className="font-mono text-xs text-[var(--text)]">v{v.version}</span>
        {isCurrent && (
          <span className="rounded bg-[#1f6feb]/20 px-1.5 py-0.5 text-[10px] text-[#6ee7ff]">current</span>
        )}
        <AdmissionBadge state={v.admissionState} />
        {v.autoApproved && (
          <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-400">auto</span>
        )}
        {hasFailures && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-rose-400">
            <XCircle className="h-3 w-3" />
            {v.failureReasons.length} failure{v.failureReasons.length !== 1 ? 's' : ''}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {v.admissionState === 'discovered' || v.admissionState === 'rejected' ? (
            <button
              type="button"
              onClick={() => onValidate(v.version)}
              disabled={isPending}
              className="rounded border border-[var(--border-soft)] bg-[var(--panel)] px-2 py-1 text-[10px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40"
            >
              Re-validate
            </button>
          ) : null}
          {v.admissionState === 'validated' || v.admissionState === 'pending_approval' ? (
            <button
              type="button"
              onClick={() => onApprove(v.version)}
              disabled={isPending}
              className="rounded border border-[var(--s-ok-bd)] bg-[var(--s-ok-bg)] px-2 py-1 text-[10px] text-[var(--s-ok-tx)] disabled:opacity-40"
            >
              Approve
            </button>
          ) : null}
          {v.admissionState === 'registered' ? (
            <>
              <button
                type="button"
                onClick={() => onInstantiate(v.version)}
                disabled={isPending}
                className="flex items-center gap-1 rounded border border-[var(--s-ok-bd)] bg-[var(--s-ok-bg)] px-2 py-1 text-[10px] text-[var(--s-ok-tx)] disabled:opacity-40"
              >
                <Zap className="h-2.5 w-2.5" />
                Instantiate
              </button>
              {!isCurrent && (
                <button
                  type="button"
                  onClick={() => onRollback(v.version)}
                  disabled={isPending}
                  className="flex items-center gap-1 rounded border border-[var(--border-soft)] bg-[var(--panel)] px-2 py-1 text-[10px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40"
                >
                  <RotateCcw className="h-2.5 w-2.5" />
                  Set current
                </button>
              )}
            </>
          ) : null}
        </div>
      </div>
      {expanded && (
        <div className="border-t border-[var(--border-soft)] px-4 py-3 text-xs text-[var(--muted)]">
          {v.commitSha && <p>SHA: <span className="font-mono text-[var(--text)]">{v.commitSha.slice(0, 12)}</span></p>}
          {v.sourcePath && <p>Path: <span className="font-mono text-[var(--text)]">{v.sourcePath}</span></p>}
          {v.sourceRef && <p>Ref: <span className="font-mono text-[var(--text)]">{v.sourceRef}</span></p>}
          {v.capabilityProfileId && <p>Profile: <span className="font-mono text-[var(--text)]">{v.capabilityProfileId.slice(0, 8)}…</span></p>}
          <p>Created: {new Date(v.createdAt).toLocaleString()}</p>
          {hasFailures && <FailureList reasons={v.failureReasons} />}
        </div>
      )}
    </div>
  )
}

// ── Template detail panel ────────────────────────────────────────────────────

interface TemplateDetailProps {
  templateId: string
  onClose: () => void
}

function TemplateDetail({ templateId, onClose }: TemplateDetailProps) {
  const { data, isLoading, error } = useTemplate(templateId)
  const approve = useApproveVersion()
  const validate = useValidateVersion()
  const instantiate = useInstantiateVersion()
  const rollback = useRollbackTemplate()
  const deprecate = useDeprecateTemplate()
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const isPending = approve.isPending || validate.isPending || instantiate.isPending || rollback.isPending || deprecate.isPending

  const withFeedback = async (label: string, fn: () => Promise<unknown>) => {
    setActionMsg(null)
    try {
      const result = await fn() as Record<string, unknown> | null
      if (result && 'error' in result && result.error) {
        setActionMsg(`Error: ${result.error}`)
      } else if (result && 'agentId' in result) {
        setActionMsg(`Agent created: ${result.agentId as string}`)
      } else {
        setActionMsg(`${label} succeeded`)
      }
    } catch (e) {
      setActionMsg(`Error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const template = data?.template
  const versions = data?.versions ?? []

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-[var(--border-soft)] px-5 py-3">
        <button
          type="button"
          onClick={onClose}
          className="text-[var(--muted)] hover:text-[var(--text)]"
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <p className="truncate font-mono text-sm font-medium text-[var(--text)]">{templateId}</p>
          {template && <p className="text-xs text-[var(--muted)]">{template.name}</p>}
        </div>
        {template && (
          <div className="flex items-center gap-2">
            <LifecycleBadge state={template.lifecycleState} />
            {template.lifecycleState !== 'deprecated' && (
              <button
                type="button"
                onClick={() => withFeedback('Deprecate', () => deprecate.mutateAsync(templateId))}
                disabled={isPending}
                className="flex items-center gap-1 rounded border border-rose-400/30 bg-rose-400/5 px-2 py-1 text-[10px] text-rose-400 hover:bg-rose-400/10 disabled:opacity-40"
              >
                <Trash2 className="h-2.5 w-2.5" />
                Deprecate
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {isLoading && <p className="text-sm text-[var(--muted)]">Loading…</p>}
        {error && <p className="text-sm text-rose-400">Failed to load template</p>}
        {actionMsg && (
          <div className={`mb-4 rounded border px-3 py-2 text-xs ${actionMsg.startsWith('Error') ? 'border-rose-400/30 bg-rose-400/5 text-rose-300' : 'border-emerald-400/30 bg-emerald-400/5 text-emerald-300'}`}>
            {actionMsg}
          </div>
        )}
        {versions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[var(--muted)]">Version history</p>
            {versions
              .slice()
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .map((v) => (
                <VersionRow
                  key={v.id}
                  v={v}
                  templateId={templateId}
                  currentVersionId={template?.currentVersionId}
                  onApprove={(version) => withFeedback('Approve', () => approve.mutateAsync({ templateId, version }))}
                  onValidate={(version) => withFeedback('Validate', () => validate.mutateAsync({ templateId, version }))}
                  onInstantiate={(version) => withFeedback('Instantiate', () => instantiate.mutateAsync({ templateId, version }))}
                  onRollback={(version) => withFeedback('Rollback', () => rollback.mutateAsync({ templateId, version }))}
                  isPending={isPending}
                />
              ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Template list row ────────────────────────────────────────────────────────

function templateAdmissionState(t: CatalogTemplateSummary): string {
  // lifecycleState on catalog_templates is 'active' | 'deprecated'; the admission
  // state lives on versions.  For list display we show lifecycle state.
  return t.lifecycleState
}

interface TemplateRowProps {
  t: CatalogTemplateSummary
  selected: boolean
  onSelect: () => void
}

function TemplateRow({ t, selected, onSelect }: TemplateRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition ${
        selected
          ? 'border-[#1f6feb]/60 bg-[#1f6feb]/10'
          : 'border-[var(--border-soft)] bg-[var(--panel)] hover:bg-[var(--panel-subtle)]'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium text-[var(--text)]">{t.templateId}</span>
          <LifecycleBadge state={templateAdmissionState(t)} />
        </div>
        <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{t.name}</p>
      </div>
      <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-[var(--muted)]" />
    </div>
  )
}

// ── Templates tab ────────────────────────────────────────────────────────────

function TemplatesTab() {
  const { data: templates, isLoading, error } = useTemplates()
  const sync = useSyncCatalog()
  const migrate = useMigrate()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [migrateMsg, setMigrateMsg] = useState<string | null>(null)

  const filtered = (templates ?? []).filter((t) => {
    const q = query.trim().toLowerCase()
    return !q || t.templateId.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)
  })

  const handleSync = async () => {
    setSyncMsg(null)
    try {
      const result = await sync.mutateAsync({})
      const admitted = result.results.filter((r) => r.outcome === 'admitted').length
      const rejected = result.results.filter((r) => r.outcome === 'rejected').length
      setSyncMsg(`Sync complete — ${admitted} admitted, ${rejected} rejected, ${result.results.length - admitted - rejected} unchanged`)
    } catch (e) {
      setSyncMsg(`Sync failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleMigrate = async () => {
    setMigrateMsg(null)
    try {
      const result = await migrate.mutateAsync(false)
      setMigrateMsg(`Migration preview: ${result.drafts.length} templates drafted`)
    } catch (e) {
      setMigrateMsg(`Migrate failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (selected) {
    return (
      <div className="flex h-full flex-col">
        <TemplateDetail templateId={selected} onClose={() => setSelected(null)} />
      </div>
    )
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search templates…"
          className="w-full max-w-56 rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-1.5 text-xs text-[var(--text)] placeholder:text-[var(--muted)]"
        />
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={handleMigrate}
            disabled={migrate.isPending}
            className="flex items-center gap-1.5 rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--panel-subtle)] hover:text-[var(--text)] disabled:opacity-40"
          >
            <Upload className="h-3 w-3" />
            Preview migration
          </button>
          <button
            type="button"
            onClick={handleSync}
            disabled={sync.isPending}
            className="flex items-center gap-1.5 rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--panel-subtle)] hover:text-[var(--text)] disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${sync.isPending ? 'animate-spin' : ''}`} />
            Sync
          </button>
        </div>
      </div>

      {syncMsg && (
        <div className={`rounded border px-3 py-2 text-xs ${syncMsg.startsWith('Sync failed') ? 'border-rose-400/30 bg-rose-400/5 text-rose-300' : 'border-emerald-400/30 bg-emerald-400/5 text-emerald-300'}`}>
          {syncMsg}
        </div>
      )}
      {migrateMsg && (
        <div className="rounded border border-sky-400/30 bg-sky-400/5 px-3 py-2 text-xs text-sky-300">
          {migrateMsg}
        </div>
      )}

      {isLoading && <p className="text-sm text-[var(--muted)]">Loading templates…</p>}
      {error && <p className="text-sm text-rose-400">Failed to load templates</p>}

      {!isLoading && filtered.length === 0 ? (
        <div className="rounded-[1rem] border border-dashed border-[var(--border-soft)] bg-[var(--panel-subtle)] p-8 text-center text-sm text-[var(--muted)]">
          No templates found.{' '}
          <button type="button" onClick={handleSync} className="text-[var(--accent)] underline underline-offset-2">
            Sync from source
          </button>{' '}
          to discover templates.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => (
            <TemplateRow key={t.id} t={t} selected={selected === t.templateId} onSelect={() => setSelected(t.templateId)} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Sources tab ──────────────────────────────────────────────────────────────

function SourcesTab() {
  const { data: sources, isLoading, error } = useCatalogSources()
  const create = useCreateCatalogSource()
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ kind: 'local' as 'local' | 'git', name: '', location: '', defaultRef: '', subpath: '' })
  const [msg, setMsg] = useState<string | null>(null)

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    try {
      await create.mutateAsync({
        kind: form.kind,
        name: form.name,
        location: form.location,
        defaultRef: form.defaultRef || undefined,
        subpath: form.subpath || undefined,
      })
      setMsg('Source added')
      setAdding(false)
      setForm({ kind: 'local', name: '', location: '', defaultRef: '', subpath: '' })
    } catch (e) {
      setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--muted)]">Catalog sources define where YAML templates are loaded from.</p>
        <button
          type="button"
          onClick={() => setAdding((a) => !a)}
          className="flex items-center gap-1.5 rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--panel-subtle)] hover:text-[var(--text)]"
        >
          <PlusCircle className="h-3 w-3" />
          Add source
        </button>
      </div>

      {msg && (
        <div className={`rounded border px-3 py-2 text-xs ${msg.startsWith('Error') ? 'border-rose-400/30 bg-rose-400/5 text-rose-300' : 'border-emerald-400/30 bg-emerald-400/5 text-emerald-300'}`}>
          {msg}
        </div>
      )}

      {adding && (
        <form onSubmit={handleAdd} className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel)] p-4 space-y-3">
          <p className="text-xs font-medium text-[var(--text)]">New catalog source</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[10px] text-[var(--muted)]">Kind</label>
              <select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as 'local' | 'git' })}
                className="w-full rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-2 py-1.5 text-xs text-[var(--text)]"
              >
                <option value="local">local</option>
                <option value="git">git</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-[var(--muted)]">Name</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="default-local"
                className="w-full rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-2 py-1.5 text-xs text-[var(--text)]"
              />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-[10px] text-[var(--muted)]">Location (path or repo URL)</label>
              <input
                required
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="/app/backend/catalog"
                className="w-full rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-2 py-1.5 text-xs text-[var(--text)]"
              />
            </div>
            {form.kind === 'git' && (
              <div>
                <label className="mb-1 block text-[10px] text-[var(--muted)]">Default ref</label>
                <input
                  value={form.defaultRef}
                  onChange={(e) => setForm({ ...form, defaultRef: e.target.value })}
                  placeholder="main"
                  className="w-full rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-2 py-1.5 text-xs text-[var(--text)]"
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-[10px] text-[var(--muted)]">Subpath (optional)</label>
              <input
                value={form.subpath}
                onChange={(e) => setForm({ ...form, subpath: e.target.value })}
                placeholder="catalog/"
                className="w-full rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-2 py-1.5 text-xs text-[var(--text)]"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={create.isPending}
              className="rounded border border-[var(--s-ok-bd)] bg-[var(--s-ok-bg)] px-3 py-1.5 text-xs text-[var(--s-ok-tx)] disabled:opacity-40"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-1.5 text-xs text-[var(--muted)]"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {isLoading && <p className="text-sm text-[var(--muted)]">Loading sources…</p>}
      {error && <p className="text-sm text-rose-400">Failed to load sources</p>}

      {!isLoading && (sources ?? []).length === 0 && !adding ? (
        <div className="rounded-[1rem] border border-dashed border-[var(--border-soft)] bg-[var(--panel-subtle)] p-8 text-center text-sm text-[var(--muted)]">
          No sources configured.
        </div>
      ) : (
        <div className="space-y-2">
          {(sources ?? []).map((s) => (
            <div key={s.id} className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm text-[var(--text)]">{s.name}</span>
                <span className="rounded bg-[var(--panel-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">{s.kind}</span>
                {s.enabled ? (
                  <CheckCircle className="h-3 w-3 text-emerald-400" />
                ) : (
                  <XCircle className="h-3 w-3 text-rose-400" />
                )}
              </div>
              <p className="mt-1 font-mono text-xs text-[var(--muted)]">{s.location}</p>
              {s.defaultRef && <p className="mt-0.5 text-[10px] text-[var(--muted)]">ref: {s.defaultRef}</p>}
              {s.subpath && <p className="mt-0.5 text-[10px] text-[var(--muted)]">subpath: {s.subpath}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Catalog page ─────────────────────────────────────────────────────────────

export function Catalog() {
  const [activeTab, setActiveTab] = useState<TabId>('templates')

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 border-b border-[var(--border-soft)] bg-[var(--topbar-bg)] px-4 py-2.5 backdrop-blur">
        <div className="flex gap-1.5 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 rounded border px-3 py-1.5 text-xs font-medium transition ${
                activeTab === tab.id
                  ? 'border-[#6ee7ff] bg-[#1f6feb] text-white'
                  : 'border-[var(--border-soft)] bg-[var(--panel-subtle)] text-[var(--muted)] hover:bg-[var(--panel)] hover:text-[var(--text)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        {activeTab === 'templates' && <TemplatesTab />}
        {activeTab === 'sources' && <SourcesTab />}
      </div>
    </div>
  )
}
