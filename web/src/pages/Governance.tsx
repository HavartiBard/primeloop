import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchAgentWorkspace,
  fetchAgentWorkspaceFile,
  fetchPrimeConfig,
  fetchPrimeModules,
  fetchPrimeModuleAudit,
  fetchPrimeProfile,
  fetchProviders,
  fetchSetupProviderModels,
  saveAgentWorkspaceFile,
  updateAgentWorkspace,
  initAgentWorkspace,
  updatePrimeConfig,
  updatePrimeModule,
  updatePrimeProfile,
  patchPrimeProfileSection,
} from '../api'
import type {
  ModelRouteEntry,
  FunctionModelPreference,
  ModelPreferences,
  PrimeModuleConfig,
  PrimeModuleConfigAudit,
  PrimeProfileResponse,
  Provider,
} from '../types'

type SettingsTab = 'system' | 'models' | 'modules' | 'profile' | 'workspace'
const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'system', label: 'System' },
  { id: 'models', label: 'Models' },
  { id: 'modules', label: 'Modules' },
  { id: 'profile', label: 'Profile' },
  { id: 'workspace', label: 'Workspace' },
]
const FUNC_LABELS: Record<string, string> = { planning: 'Planning', routing: 'Routing', context: 'Context Assembly', policy: 'Policy Evaluation' }

type WS_Scope = 'all' | 'prime' | 'agents' | 'shared'
type WS_Cat = 'all' | 'prompts' | 'agents' | 'skills' | 'policies' | 'memory' | 'config'

function card(e = '') { return `rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] shadow-[0_18px_48px_rgba(2,6,23,0.18)] backdrop-blur ${e}`.trim() }
function fmt(v?: string) { return v ? new Date(v).toLocaleString() : 'N/A' }
function Header({ eyebrow, title, detail }: { eyebrow: string; title: string; detail?: string }) {
  return (<div className="mb-4 flex items-start justify-between gap-3"><div><div className="text-[10px] font-medium uppercase tracking-[0.28em] text-[var(--muted)]">{eyebrow}</div><h2 className="mt-1 text-lg font-semibold text-[var(--text)]">{title}</h2></div>{detail ? <div className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-1 text-[11px] text-[var(--muted)]">{detail}</div> : null}</div>)
}

export function Governance({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<SettingsTab>('system')

  // State (must be before queries that reference them)
  const [sys, setSys] = useState({ enabled: false, cron_fast_interval_seconds: 300, cron_slow_interval_seconds: 3600, debounce_window_ms: 10000 })
  const [mpDraft, setMpDraft] = useState<ModelPreferences>({})
  const [selFunc, setSelFunc] = useState('planning')
  const [mPinned, setMPinned] = useState<Record<string, string>>({})
  const [mConfDrafts, setMConfDrafts] = useState<Record<string, string>>({})
  const [mSaveErrs, setMSaveErrs] = useState<Record<string, string>>({})
  const [selMAudit, setSelMAudit] = useState<string | null>(null)
  const [pDraft, setPDraft] = useState<Record<string, string>>({})
  const [wsFile, setWsFile] = useState('prompts/prime/system.md')
  const [wsDraft, setWsDraft] = useState('')
  const [wsVer, setWsVer] = useState('')
  const [wsErr, setWsErr] = useState('')
  const [wsScope, setWsScope] = useState<WS_Scope>('all')
  const [wsCat, setWsCat] = useState<WS_Cat>('all')
  const [wsSearch, setWsSearch] = useState('')
  const [wsSettings, setWsSettings] = useState({ mode: 'local' as 'local' | 'git', root_path: '/var/lib/primeloop/workspace', remote_url: '', branch: 'main' })

  // Queries
  const { data: config } = useQuery({ queryKey: ['prime-config'], queryFn: fetchPrimeConfig, refetchInterval: 30_000 })
  const { data: providers = [] } = useQuery({ queryKey: ['providers'], queryFn: fetchProviders, refetchInterval: 30_000 })
  const { data: modules = [] } = useQuery({ queryKey: ['prime-modules'], queryFn: fetchPrimeModules, refetchInterval: 30_000 })
  const { data: profile } = useQuery({ queryKey: ['prime-profile'], queryFn: fetchPrimeProfile, refetchInterval: 30_000 })
  const { data: workspace } = useQuery({ queryKey: ['agent-workspace'], queryFn: fetchAgentWorkspace, refetchInterval: 30_000 })
  const { data: wf } = useQuery({ queryKey: ['agent-workspace-file', wsFile], queryFn: () => fetchAgentWorkspaceFile(wsFile), enabled: Boolean(wsFile) && tab === 'workspace' })
  const { data: mAudits = [] } = useQuery({ queryKey: ['prime-module-audit', selMAudit], queryFn: () => fetchPrimeModuleAudit(selMAudit!, 12), enabled: Boolean(selMAudit) })

  // Mutations
  const mSys = useMutation({ mutationFn: (p: any) => updatePrimeConfig(p), onSuccess: () => qc.invalidateQueries({ queryKey: ['prime-config'] }) })
  const mModPref = useMutation({ mutationFn: (p: ModelPreferences) => updatePrimeConfig({ model_preferences: p }), onSuccess: () => qc.invalidateQueries({ queryKey: ['prime-config'] }) })
  const mMod = useMutation({ mutationFn: ({ moduleId, patch }: { moduleId: string; patch: any }) => updatePrimeModule(moduleId, patch), onSuccess: () => qc.invalidateQueries({ queryKey: ['prime-modules'] }) })
  const mProf = useMutation({ mutationFn: (d: any) => updatePrimeProfile(d), onSuccess: () => qc.invalidateQueries({ queryKey: ['prime-profile'] }) })
  const mProfSec = useMutation({ mutationFn: ({ key, new_text }: { key: string; new_text: string }) => patchPrimeProfileSection(key as any, new_text), onSuccess: () => qc.invalidateQueries({ queryKey: ['prime-profile'] }) })
  const mWsSave = useMutation({
    mutationFn: ({ filePath, content, expectedVersion }: { filePath: string; content: string; expectedVersion?: string }) => saveAgentWorkspaceFile(filePath, content, expectedVersion),
    onSuccess: async (sf) => { setWsVer(sf.version); setWsErr(''); await qc.invalidateQueries({ queryKey: ['agent-workspace'] }); await qc.invalidateQueries({ queryKey: ['agent-workspace-file', wsFile] }) },
    onError: (e) => setWsErr(e instanceof Error ? e.message : 'Failed to save'),
  })
  const mWsInit = useMutation({ mutationFn: initAgentWorkspace, onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-workspace'] }) })
  const mWsCfg = useMutation({ mutationFn: (d: any) => updateAgentWorkspace(d), onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-workspace'] }) })

  // Sync
  useEffect(() => { if (!config) return; setSys({ enabled: config.enabled, cron_fast_interval_seconds: config.cron_fast_interval_seconds, cron_slow_interval_seconds: config.cron_slow_interval_seconds, debounce_window_ms: config.debounce_window_ms }); setMpDraft(config.model_preferences ?? {}) }, [config])
  useEffect(() => { if (!wf) return; setWsDraft(wf.content); setWsVer(wf.version); setWsErr('') }, [wf])
  useEffect(() => { if (!workspace) return; setWsSettings({ mode: workspace.mode, root_path: workspace.root_path, remote_url: workspace.remote_url ?? '', branch: workspace.branch }) }, [workspace])
  useEffect(() => { if (!profile) return; setPDraft({ identity: profile.soul?.identity ?? '', voice_tone: profile.soul?.voice_tone ?? '', decision_style: profile.soul?.decision_style ?? '', default_behaviors: profile.operating?.default_behaviors ?? '', approval_thresholds: profile.operating?.approval_thresholds ?? '' }) }, [profile])
  useEffect(() => { setMPinned(Object.fromEntries(modules.map((m) => [m.module_id, m.pinned_version ?? '']))); setMConfDrafts(Object.fromEntries(modules.map((m) => [m.module_id, JSON.stringify(m.config ?? {}, null, 2)]))); setMSaveErrs({}) }, [modules])

  // Workspace helpers
  function topFolder(f: string): WS_Cat { const [d] = f.split('/', 1); return ['prompts', 'agents', 'skills', 'policies', 'memory', 'config'].includes(d) ? d as WS_Cat : 'all' }
  function wsScopeOf(f: string): WS_Scope { if (f === 'agents/prime.md' || f.startsWith('prompts/prime/')) return 'prime'; if (f.startsWith('agents/') || f.startsWith('prompts/agents/')) return 'agents'; return 'shared' }
  const wFiles = workspace?.files ?? []
  const fFiles = useMemo(() => wFiles.filter((f) => { if (wsCat !== 'all' && topFolder(f) !== wsCat) return false; if (wsScope !== 'all' && wsScopeOf(f) !== wsScope) return false; if (wsSearch.trim() && !f.toLowerCase().includes(wsSearch.trim().toLowerCase())) return false; return true }), [wsCat, wFiles, wsScope, wsSearch])
  useEffect(() => { if (tab === 'workspace' && fFiles.length > 0 && !fFiles.includes(wsFile)) setWsFile(fFiles[0]) }, [fFiles, wsFile, tab])
  useEffect(() => { setWsErr('') }, [wsFile])

  // Module helpers
  function togMod(m: PrimeModuleConfig) { mMod.mutate({ moduleId: m.module_id, patch: { enabled: !m.enabled } }) }
  function setModRollout(m: PrimeModuleConfig, r: PrimeModuleConfig['rollout_mode']) { mMod.mutate({ moduleId: m.module_id, patch: { rollout_mode: r } }) }
  function saveMod(m: PrimeModuleConfig) {
    let pc: Record<string, unknown>
    try { const p = JSON.parse(mConfDrafts[m.module_id] ?? '{}') as unknown; if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Must be object'); pc = p as Record<string, unknown> }
    catch (e) { setMSaveErrs((c) => ({ ...c, [m.module_id]: e instanceof Error ? e.message : 'Invalid JSON' })); return }
    setMSaveErrs((c) => ({ ...c, [m.module_id]: '' }))
    mMod.mutate({ moduleId: m.module_id, patch: { pinned_version: (mPinned[m.module_id] ?? '').trim() || null, config: pc } })
  }

  // Model prefs helpers
  const curPref = mpDraft[selFunc] ?? null
  const avlProviders = providers.filter((p) => p.type !== 'codex')
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({})
  const [modelsLoading, setModelsLoading] = useState(false)
  // Track which provider was explicitly selected to avoid re-fetching on model auto-fill
  const primaryProvRef = useRef('')
  const fbProvRefs = useRef<Record<number, string>>({})

  function setPref(ft: string, p: FunctionModelPreference | null) { setMpDraft((c) => { const n = { ...c }; if (!p) delete n[ft]; else n[ft] = p; return n }) }
  function addFb(ft: string) { setMpDraft((c) => { const e = c[ft]; if (!e) return c; return { ...c, [ft]: { ...e, fallbacks: [...e.fallbacks, { provider_id: avlProviders[0]?.id ?? '', model: '' }] } } }) }
  function rmFb(ft: string, i: number) { setMpDraft((c) => { const e = c[ft]; if (!e) return c; return { ...c, [ft]: { ...e, fallbacks: e.fallbacks.filter((_, j) => j !== i) } } }) }
  function updFb(ft: string, i: number, v: ModelRouteEntry) { setMpDraft((c) => { const e = c[ft]; if (!e) return c; return { ...c, [ft]: { ...e, fallbacks: e.fallbacks.map((f, j) => j === i ? v : f) } } }) }

  // Helper to safely update primary model fields in JSX onChange
  function _cur() { return curPref ?? { primary: { provider_id: '', model: '' }, fallbacks: [] as ModelRouteEntry[] } }

  async function loadModelsForProvider(providerId: string) {
    const prov = providers.find((p) => p.id === providerId)
    if (!prov) return
    setModelsLoading(true)
    try {
      const result = await fetchSetupProviderModels({
        type: prov.type,
        base_url: prov.base_url,
        ...(prov.api_key ? { api_key: prov.api_key } : {}),
      })
      if (result.models && result.models.length > 0) {
        setProviderModels((c) => ({ ...c, [providerId]: result.models }))
      }
    } catch {
      // silently fail — falls back to text input
    } finally {
      setModelsLoading(false)
    }
  }

  function setPrimaryPid(v: string) {
    const p = _cur()
    const oldModel = p.primary.model
    primaryProvRef.current = v
    // Auto-select first model from discovered list, or keep existing if it matches
    const models = v ? (providerModels[v] ?? []) : []
    const autoModel = models.length > 0 && !models.includes(oldModel) ? models[0] : oldModel
    setPref(selFunc, { ...p, primary: { provider_id: v, model: autoModel } })
    // Load models if not yet cached
    if (v && !providerModels[v]) loadModelsForProvider(v)
  }
  function setPrimaryModel(v: string) { const p = _cur(); setPref(selFunc, { ...p, primary: { ...p.primary, model: v } }) }
  function setFbPid(i: number, v: string) {
    const fb = curPref?.fallbacks[i]
    const oldModel = fb?.model ?? ''
    fbProvRefs.current = { ...fbProvRefs.current, [i]: v }
    const models = v ? (providerModels[v] ?? []) : []
    const autoModel = models.length > 0 && !models.includes(oldModel) ? models[0] : oldModel
    updFb(selFunc, i, { provider_id: v, model: autoModel })
    if (v && !providerModels[v]) loadModelsForProvider(v)
  }
  function setFbModel(i: number, v: string) { updFb(selFunc, i, { ...curPref?.fallbacks[i]!, model: v }) }

  // Re-fetch models when providers list changes (in case base_url/api_key was updated)
  useEffect(() => {
    const toLoad = new Set<string>()
    if (curPref?.primary?.provider_id && !providerModels[curPref.primary.provider_id]) {
      toLoad.add(curPref.primary.provider_id)
      primaryProvRef.current = curPref.primary.provider_id
    }
    curPref?.fallbacks.forEach((fb, i) => {
      if (fb.provider_id && !providerModels[fb.provider_id]) {
        toLoad.add(fb.provider_id)
        fbProvRefs.current = { ...fbProvRefs.current, [i]: fb.provider_id }
      }
    })
    toLoad.forEach(loadModelsForProvider)
  }, [providers])

  // UI
  const tbCls = (t: SettingsTab) => `relative -mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition ${tab === t ? 'border-[var(--accent)] text-[var(--text)]' : 'border-transparent text-[var(--muted)] hover:border-[var(--border-soft)] hover:text-[var(--text)]'}`
  const SCOPE_OPT = [{ v: 'all', l: 'All scopes' }, { v: 'prime', l: 'Prime' }, { v: 'agents', l: 'Agents' }, { v: 'shared', l: 'Shared' }] as const
  const CAT_OPT = [{ v: 'all', l: 'All folders' }, { v: 'prompts', l: 'Prompts' }, { v: 'agents', l: 'Agents' }, { v: 'skills', l: 'Skills' }, { v: 'policies', l: 'Policies' }, { v: 'memory', l: 'Memory' }, { v: 'config', l: 'Config' }] as const

  return (
    <div className={embedded ? 'h-full overflow-y-auto px-4 py-4' : 'min-h-screen px-4 py-4 sm:px-6 lg:px-8'}>
      <section className="space-y-5">
        <div className={card('p-5 sm:p-6')}>
          <Header eyebrow="Settings" title="Control Plane Settings" detail={SETTINGS_TABS.find((t) => t.id === tab)?.label} />
          <div className="overflow-x-auto border-b border-[var(--border-soft)]"><div className="flex min-w-max gap-1">{SETTINGS_TABS.map((t) => (<button key={t.id} type="button" onClick={() => setTab(t.id)} className={tbCls(t.id)}>{t.label}</button>))}</div></div>
        </div>

        {/* SYSTEM */}
        {tab === 'system' && (<div className={`${card()} p-5 sm:p-6`}>
          <Header eyebrow="System" title="Prime Agent Configuration" />
          <div className="space-y-5">
            <div className="flex items-center justify-between rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
              <div><div className="text-sm font-semibold text-[var(--text)]">Prime Agent Enabled</div><div className="mt-1 text-xs text-[var(--muted)]">When enabled, Prime processes events and runs the decision loop.</div></div>
              <button type="button" onClick={() => { setSys((d) => ({ ...d, enabled: !d.enabled })); mSys.mutate({ enabled: !sys.enabled }) }} className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition ${sys.enabled ? 'bg-emerald-500' : 'bg-gray-400'}`}>
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${sys.enabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4"><div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Fast Cron (seconds)</div><input type="number" min={1} value={sys.cron_fast_interval_seconds} onChange={(e) => setSys((d) => ({ ...d, cron_fast_interval_seconds: parseInt(e.target.value) || 300 }))} className="mt-2 w-full rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]" /></div>
              <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4"><div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Slow Cron (seconds)</div><input type="number" min={1} value={sys.cron_slow_interval_seconds} onChange={(e) => setSys((d) => ({ ...d, cron_slow_interval_seconds: parseInt(e.target.value) || 3600 }))} className="mt-2 w-full rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]" /></div>
              <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4"><div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Debounce (ms)</div><input type="number" min={0} value={sys.debounce_window_ms} onChange={(e) => setSys((d) => ({ ...d, debounce_window_ms: parseInt(e.target.value) || 0 }))} className="mt-2 w-full rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]" /></div>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-xs text-[var(--muted)]">Status: <span className="font-medium text-[var(--text)]">{config?.status ?? 'loading'}</span>{config?.last_started_at && <> · Last started: {fmt(config.last_started_at)}</>}</div>
              <button onClick={() => mSys.mutate(sys)} disabled={mSys.isPending} className="rounded-full border border-[var(--sel-bd)] bg-[var(--sel-bg)] px-4 py-1.5 text-xs text-blue-300 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60">Save System Settings</button>
            </div>
            {config?.last_error && (<div className="rounded-[1rem] border border-rose-300/20 bg-rose-300/10 p-4"><div className="text-xs font-medium text-rose-100">Last Error</div><div className="mt-1 text-xs text-rose-50/70">{config.last_error}</div></div>)}
          </div>
        </div>)}

        {/* MODELS */}
        {tab === 'models' && (<div className={`${card()} p-5 sm:p-6`}>
          <Header eyebrow="Models" title="Model Preferences" detail={`${Object.keys(mpDraft).length} function(s) configured`} />
          <div className="space-y-5">
            <div><div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Function Type</div>
              <div className="mt-2 flex flex-wrap gap-2">{Object.entries(FUNC_LABELS).map(([k, l]) => (<button key={k} type="button" onClick={() => setSelFunc(k)} className={`rounded-full border px-3 py-1.5 text-xs transition ${selFunc === k ? 'border-[var(--sel-bd)] bg-[var(--sel-bg)] text-blue-300' : 'border-[var(--border-soft)] bg-[var(--panel-subtle)] text-[var(--muted)] hover:text-[var(--text)]'}`}>{l}</button>))}</div>
            </div>
            <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
              <div className="text-sm font-semibold text-[var(--text)]">{FUNC_LABELS[selFunc]} Model Chain</div>
              <div className="mt-1 text-xs text-[var(--muted)]">Prime tries each model in order. If the primary fails, it falls back to the next one.</div>
              <div className="mt-4"><div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Primary Model</div>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <select value={curPref?.primary?.provider_id ?? ''} onChange={(e) => setPrimaryPid(e.target.value)} className="rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]">
                    <option value="">Select provider...</option>{avlProviders.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</select>
                  {(() => {
                    const primaryProvId = curPref?.primary?.provider_id ?? ''
                    const models = primaryProvId ? (providerModels[primaryProvId] ?? []) : []
                    return models.length > 0 ? (
                      <select value={curPref?.primary?.model ?? ''} onChange={(e) => setPrimaryModel(e.target.value)} className="rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]">
                        {models.length === 0 && <option value="">No models</option>}
                        {models.map((m) => (<option key={m} value={m}>{m}</option>))}
                      </select>
                    ) : (
                      <input placeholder={modelsLoading ? 'Loading models...' : 'Model name (e.g., claude-sonnet-4)'} value={curPref?.primary?.model ?? ''} onChange={(e) => setPrimaryModel(e.target.value)} className="rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]" />
                    )
                  })()}
                </div>
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between"><div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Fallbacks</div>
                  <button type="button" onClick={() => addFb(selFunc)} disabled={avlProviders.length === 0} className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-1 text-[11px] text-[var(--text)] transition hover:bg-[var(--panel-subtle)] disabled:cursor-not-allowed disabled:opacity-60">+ Add Fallback</button></div>
                {curPref?.fallbacks && curPref.fallbacks.length > 0 ? (<div className="mt-2 space-y-2">{curPref.fallbacks.map((fb, i) => (<div key={i} className="flex items-center gap-2"><span className="shrink-0 text-xs text-[var(--muted)]">#{i + 1}</span><select value={fb.provider_id} onChange={(e) => setFbPid(i, e.target.value)} className="flex-1 rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"><option value="">Select provider...</option>{avlProviders.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</select>{(() => {
                            const fbModels = fb.provider_id ? (providerModels[fb.provider_id] ?? []) : []
                            return fbModels.length > 0 ? (
                              <select value={fb.model} onChange={(e) => setFbModel(i, e.target.value)} className="w-48 shrink-0 rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]">
                                {fbModels.map((m) => (<option key={m} value={m}>{m}</option>))}
                              </select>
                            ) : (
                              <input placeholder={modelsLoading ? 'Loading...' : 'Model name'} value={fb.model} onChange={(e) => setFbModel(i, e.target.value)} className="w-48 shrink-0 rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]" />
                            )
                          })()}<button type="button" onClick={() => rmFb(selFunc, i)} className="shrink-0 rounded-full border border-rose-300/20 bg-rose-300/10 px-2 py-1 text-xs text-rose-50 transition hover:bg-rose-300/20">✕</button></div>))}</div>) : (<div className="mt-2 rounded-lg border border-dashed border-[var(--border-soft)] bg-[var(--panel)] p-3 text-xs text-[var(--muted)]">No fallbacks. Prime will use only the primary model.</div>)}
              </div>
              {curPref && (<div className="mt-3 flex justify-end"><button type="button" onClick={() => setPref(selFunc, null)} className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-1.5 text-xs text-[var(--muted)] transition hover:bg-[var(--panel-subtle)]">Clear {FUNC_LABELS[selFunc]} Preferences</button></div>)}
            </div>
            <div className="flex justify-end"><button onClick={() => mModPref.mutate(mpDraft)} disabled={mModPref.isPending} className="rounded-full border border-[var(--sel-bd)] bg-[var(--sel-bg)] px-4 py-1.5 text-xs text-blue-300 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60">Save Model Preferences</button></div>
            {avlProviders.length === 0 && (<div className="rounded-[1rem] border border-dashed border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4 text-sm text-[var(--muted)]">No non-codex providers configured. Add providers first in the Providers page.</div>)}
          </div>
        </div>)}

        {/* MODULES */}
        {tab === 'modules' && (<div className={`${card()} p-5 sm:p-6`}>
          <Header eyebrow="Prime" title="Module Registry" detail={`${modules.length} modules`} />
          <div className="space-y-3">{modules.map((m) => (
            <div key={m.module_id} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-sm font-semibold text-[var(--text)]">{m.module_id}</div><div className="mt-1 text-xs text-[var(--muted)]">{m.stage} · default {m.default_version}{m.pinned_version ? ` · pinned ${m.pinned_version}` : ' · unpinned'}</div></div>
                <div className="flex flex-wrap gap-2"><span className={`rounded-full border px-3 py-1 text-xs ${m.enabled ? 'border-emerald-300/20 bg-emerald-300/12 text-emerald-50' : 'border-rose-300/20 bg-rose-300/12 text-rose-50'}`}>{m.enabled ? 'enabled' : 'disabled'}</span><span className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-1 text-xs text-[var(--muted)]">{m.rollout_mode}</span></div></div>
              <div className="mt-3 grid gap-3 lg:grid-cols-[auto_auto_1fr] lg:items-center">
                <button type="button" onClick={() => togMod(m)} disabled={mMod.isPending} className="rounded-full border border-[var(--sel-bd)] bg-[var(--sel-bg)] px-4 py-1.5 text-xs text-blue-300 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60">{m.enabled ? 'Disable' : 'Enable'}</button>
                <select value={m.rollout_mode} onChange={(e) => setModRollout(m, e.target.value as PrimeModuleConfig['rollout_mode'])} className="rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"><option value="active">active</option><option value="shadow">shadow</option></select>
                <div className="text-xs text-[var(--muted)]">Updated {fmt(m.updated_at)}</div></div>
              <div className="mt-3 flex justify-end"><button type="button" onClick={() => setSelMAudit((c) => c === m.module_id ? null : m.module_id)} className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-1.5 text-xs text-[var(--text)] transition hover:bg-[var(--panel-subtle)]">{selMAudit === m.module_id ? 'Hide Audit' : 'Show Audit'}</button></div>
              <div className="mt-3 grid gap-3 lg:grid-cols-3">
                <div><div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Pinned Version</div><input value={mPinned[m.module_id] ?? ''} onChange={(e) => setMPinned((c) => ({ ...c, [m.module_id]: e.target.value }))} placeholder="leave blank for default" className="mt-2 w-full rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]" /></div>
                <div><div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Config JSON</div><textarea value={mConfDrafts[m.module_id] ?? '{}'} onChange={(e) => setMConfDrafts((c) => ({ ...c, [m.module_id]: e.target.value }))} rows={3} className="mt-2 w-full rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 font-mono text-xs text-[var(--text)]" /></div>
                <div className="flex items-end"><button type="button" onClick={() => saveMod(m)} disabled={mMod.isPending} className="rounded-full border border-[var(--sel-bd)] bg-[var(--sel-bg)] px-4 py-1.5 text-xs text-blue-300 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60">Save</button></div>
              </div>
              {mSaveErrs[m.module_id] && (<div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">{mSaveErrs[m.module_id]}</div>)}
              {selMAudit === m.module_id && (<div className="mt-3 rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel)] p-3">
                <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Audit History</div>
                <div className="mt-3 space-y-3">
                  {mAudits.map((a: PrimeModuleConfigAudit) => (<div key={a.id} className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3">
                    <div className="flex items-center justify-between"><div className="text-sm font-medium text-[var(--text)]">{a.actor}</div><div className="text-xs text-[var(--muted)]">{fmt(a.created_at)}</div></div>
                    <div className="mt-1 text-xs text-[var(--muted)]">Changed: {a.changed_fields.join(', ') || 'none'}</div>
                  </div>))}
                  {mAudits.length === 0 && (<div className="text-xs text-[var(--muted)]">No audit records yet.</div>)}
                </div>
              </div>)}
            </div>))}
          {modules.length === 0 && (<div className="rounded-[1rem] border border-dashed border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4 text-sm text-[var(--muted)]">No Prime modules discovered yet.</div>)}
          </div>
        </div>)}

        {/* PROFILE */}
        {tab === 'profile' && (<div className={`${card()} p-5 sm:p-6`}>
          <Header eyebrow="Profile" title="Prime Identity & Behavior" detail={profile ? profile.name : 'loading'} />
          <div className="space-y-4">
            {([['identity', 'Identity'], ['voice_tone', 'Voice & Tone'], ['decision_style', 'Decision Style']] as [string, string][]).map(([key, label]) => (
              <div key={key} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                <div className="flex items-center justify-between"><div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">{label}</div>
                  <button type="button" onClick={() => mProfSec.mutate({ key, new_text: pDraft[key] ?? '' })} disabled={mProfSec.isPending} className="rounded-full border border-[var(--sel-bd)] bg-[var(--sel-bg)] px-3 py-1 text-[11px] text-blue-300 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60">Save</button></div>
                <textarea value={pDraft[key] ?? ''} onChange={(e) => setPDraft((c) => ({ ...c, [key]: e.target.value }))} rows={3} className="mt-2 w-full rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]" />
              </div>
            ))}
            {([['default_behaviors', 'Default Behaviors'], ['approval_thresholds', 'Approval Thresholds']] as [string, string][]).map(([key, label]) => (
              <div key={key} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                <div className="flex items-center justify-between"><div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">{label}</div>
                  <button type="button" onClick={() => mProfSec.mutate({ key, new_text: pDraft[key] ?? '' })} disabled={mProfSec.isPending} className="rounded-full border border-[var(--sel-bd)] bg-[var(--sel-bg)] px-3 py-1 text-[11px] text-blue-300 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60">Save</button></div>
                <textarea value={pDraft[key] ?? ''} onChange={(e) => setPDraft((c) => ({ ...c, [key]: e.target.value }))} rows={3} className="mt-2 w-full rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]" />
              </div>
            ))}
          </div>
        </div>)}

        {/* WORKSPACE */}
        {tab === 'workspace' && (<div className={`${card()} p-5 sm:p-6`}>
          <Header eyebrow="Workspace" title="Agent Workspace" detail={workspace ? `${workspace.files.length} files` : 'loading'} />
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Mode</div>
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => setWsSettings((c) => ({ ...c, mode: 'local' }))} className={`rounded-full border px-3 py-1.5 text-xs transition ${wsSettings.mode === 'local' ? 'border-[var(--sel-bd)] bg-[var(--sel-bg)] text-blue-300' : 'border-[var(--border-soft)] bg-[var(--panel)] text-[var(--muted)]'}`}>Local</button>
                    <button type="button" onClick={() => setWsSettings((c) => ({ ...c, mode: 'git' }))} className={`rounded-full border px-3 py-1.5 text-xs transition ${wsSettings.mode === 'git' ? 'border-[var(--sel-bd)] bg-[var(--sel-bg)] text-blue-300' : 'border-[var(--border-soft)] bg-[var(--panel)] text-[var(--muted)]'}`}>Git</button>
                  </div></div>
              <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-4 py-3 text-xs text-[var(--muted)]">
                <div>Status: <span className="text-[var(--text)]">{workspace?.sync_status ?? 'loading'}</span></div>
                <div className="mt-1">Dirty: <span className="text-[var(--text)]">{workspace?.dirty ? 'yes' : 'no'}</span></div>
              </div></div>
            <div><div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Workspace Root</div>
              <input value={wsSettings.root_path} onChange={(e) => setWsSettings((c) => ({ ...c, root_path: e.target.value }))} className="mt-2 w-full rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]" /></div>
            {wsSettings.mode === 'git' && (<div className="grid gap-3 sm:grid-cols-2"><div><div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Remote URL</div><input value={wsSettings.remote_url} onChange={(e) => setWsSettings((c) => ({ ...c, remote_url: e.target.value }))} className="mt-2 w-full rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]" /></div><div><div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Branch</div><input value={wsSettings.branch} onChange={(e) => setWsSettings((c) => ({ ...c, branch: e.target.value }))} className="mt-2 w-full rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]" /></div></div>)}
            <div className="flex flex-wrap gap-2">
              <button onClick={() => mWsCfg.mutate(wsSettings)} disabled={mWsCfg.isPending} className="rounded-full border border-[var(--sel-bd)] bg-[var(--sel-bg)] px-4 py-1.5 text-xs text-blue-300 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60">Save Workspace Settings</button>
              <button onClick={() => mWsInit.mutate()} disabled={mWsInit.isPending} className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-1.5 text-xs text-[var(--text)] transition hover:bg-[var(--panel-subtle)] disabled:cursor-not-allowed disabled:opacity-60">Scaffold Files</button>
            </div>
            <div className="grid gap-3 rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3 lg:grid-cols-[180px_180px_minmax(0,1fr)]">
              <select value={wsScope} onChange={(e) => setWsScope(e.target.value as WS_Scope)} className="rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]">{SCOPE_OPT.map((o) => (<option key={o.v} value={o.v}>{o.l}</option>))}</select>
              <select value={wsCat} onChange={(e) => setWsCat(e.target.value as WS_Cat)} className="rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]">{CAT_OPT.map((o) => (<option key={o.v} value={o.v}>{o.l}</option>))}</select>
              <input value={wsSearch} onChange={(e) => setWsSearch(e.target.value)} placeholder="Search files by path" className="rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]" />
            </div>
            <div className="grid gap-4 xl:grid-cols-[0.42fr_0.58fr]">
              <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3">
                <div className="flex items-center justify-between"><div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Files</div><div className="text-[11px] text-[var(--muted)]">{fFiles.length} shown</div></div>
                <div className="mt-3 space-y-2">{fFiles.map((f) => (<button key={f} type="button" onClick={() => setWsFile(f)} className={`block w-full rounded-lg border px-3 py-2 text-left text-xs transition ${wsFile === f ? 'border-[var(--sel-bd)] bg-[var(--sel-bg)] text-[var(--text)]' : 'border-[var(--border-soft)] bg-[var(--panel)] text-[var(--muted)]'}`}>{f}</button>))}
                  {wFiles.length === 0 && (<div className="text-xs text-[var(--muted)]">No workspace files found yet.</div>)}
                </div></div>
              <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3">
                <div className="flex items-center justify-between"><div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">{wsFile}</div>
                  <button onClick={() => mWsSave.mutate({ filePath: wsFile, content: wsDraft, expectedVersion: wsVer })} disabled={mWsSave.isPending || !wsFile} className="rounded-full border border-[var(--sel-bd)] bg-[var(--sel-bg)] px-3 py-1.5 text-[11px] text-blue-300 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60">Save File</button></div>
                {wsErr && (<div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">{wsErr}</div>)}
                <textarea value={wsDraft} onChange={(e) => setWsDraft(e.target.value)} rows={18} className="mt-3 w-full rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 font-mono text-xs text-[var(--text)]" />
              </div></div>
          </div>
        </div>)}
      </section>
    </div>
  )
}