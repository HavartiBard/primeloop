import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useProviders } from '../hooks/useProviders'
import {
  fetchCodexAuthStatus,
  startCodexDeviceAuth,
  pollCodexDeviceAuth,
  codexApiKeyAuth,
  codexLogout,
  fetchModelCapability,
} from '../api'
import type { CodexAuthStatus, Provider, ModelCapabilityAssessment } from '../types'
import { AppModal } from '../components/AppModal'

// ─── Provider add/edit modal ──────────────────────────────────────────────────

const TYPE_OPTIONS = ['codex', 'llm', 'openai', 'anthropic', 'ollama', 'litellm', 'other']

interface FormState { name: string; type: string; base_url: string; api_key: string; model: string; timeout_ms: number }
const EMPTY_FORM: FormState = { name: '', type: 'codex', base_url: '', api_key: '', model: '', timeout_ms: 120000 }

function ProviderModal({ mode, provider, onClose, onSubmit }: {
  mode: 'add' | 'edit'; provider?: Provider; onClose: () => void; onSubmit: (data: FormState) => void
}) {
  const [form, setForm] = useState<FormState>({
    name: provider?.name ?? '',
    type: provider?.type ?? 'codex',
    base_url: provider?.base_url ?? '',
    api_key: '',
    model: provider?.model ?? '',
    timeout_ms: provider?.timeout_ms ?? 120000,
  })
  const [replacingKey, setReplacingKey] = useState(false)
  const [modelAssessment, setModelAssessment] = useState<ModelCapabilityAssessment | null>(null)
  const [modelAssessing, setModelAssessing] = useState(false)
  const assessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))
  const hasMaskedKey = provider?.api_key === '••••••••'

  // Assess model capability when model name changes (debounced 300ms)
  useEffect(() => {
    if (assessTimerRef.current) { clearTimeout(assessTimerRef.current); assessTimerRef.current = null }
    const trimmed = form.model.trim()
    if (!trimmed) { setModelAssessment(null); setModelAssessing(false); return }
    let cancelled = false
    setModelAssessing(true)
    assessTimerRef.current = setTimeout(() => {
      fetchModelCapability(trimmed)
        .then((result) => { if (!cancelled) setModelAssessment(result) })
        .catch(() => { if (!cancelled) setModelAssessment(null) })
        .finally(() => { if (!cancelled) setModelAssessing(false) })
    }, 300)
    return () => {
      cancelled = true
      if (assessTimerRef.current) { clearTimeout(assessTimerRef.current); assessTimerRef.current = null }
    }
  }, [form.model])

  return (
    <AppModal
      open
      onClose={onClose}
      eyebrow="Providers"
      title={mode === 'add' ? 'Add Provider' : 'Edit Provider'}
      tone="queued"
      widthClassName="w-[min(620px,100%)]"
      heightClassName="h-[min(88vh,760px)]"
      bodyClassName="min-h-0 flex-1 overflow-y-auto bg-[var(--panel)] p-6"
    >
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(form) }} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1">Name *</label>
            <input required value={form.name} onChange={set('name')} placeholder="e.g. openai-prod"
              className="w-full bg-[var(--panel-subtle)] border border-[var(--border-soft)] rounded px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--sel-bd)]" />
          </div>
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1">Type *</label>
            <select value={form.type} onChange={set('type')}
              className="w-full bg-[var(--panel-subtle)] border border-[var(--border-soft)] rounded px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--sel-bd)]">
              {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {form.type === 'llm' && (
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1">Model</label>
              <input value={form.model} onChange={set('model')} placeholder="anthropic/claude-sonnet-4-5"
                className="w-full bg-[var(--panel-subtle)] border border-[var(--border-soft)] rounded px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--sel-bd)]" />
              {modelAssessing && (
                <p className="mt-1.5 text-xs text-[var(--muted)] font-mono">Checking model capability…</p>
              )}
              {modelAssessment && modelAssessment.tier === 'blocked' && (
                <div className="mt-2 rounded-lg border border-rose-300/30 bg-rose-300/10 px-3 py-2">
                  <p className="text-xs font-semibold text-rose-300">⚠ Model blocked for Prime Agent</p>
                  <p className="mt-1 text-xs text-rose-200/80">{modelAssessment.warning}</p>
                </div>
              )}
              {modelAssessment && modelAssessment.tier === 'warned' && (
                <div className="mt-2 rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2">
                  <p className="text-xs font-semibold text-amber-300">⚠ Model may be underpowered</p>
                  <p className="mt-1 text-xs text-amber-200/80">{modelAssessment.warning}</p>
                </div>
              )}
            </div>
          )}
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1">Timeout (ms)</label>
            <input
              type="number"
              min={5000}
              step={1000}
              value={form.timeout_ms}
              onChange={(e) => setForm((f) => ({ ...f, timeout_ms: Number(e.target.value) }))}
              className="w-full bg-[var(--panel-subtle)] border border-[var(--border-soft)] rounded px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--sel-bd)]"
            />
            <p className="mt-1 text-[11px] text-[var(--muted)]">Default is 120000ms. Raise this for slow local models.</p>
          </div>
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1">
              {form.type === 'llm' ? 'API Proxy URL *' : 'Base URL *'}
            </label>
            <input required value={form.base_url} onChange={set('base_url')} placeholder="ws://localhost:10101"
              className="w-full bg-[var(--panel-subtle)] border border-[var(--border-soft)] rounded px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--sel-bd)]" />
          </div>
          {mode === 'edit' && hasMaskedKey && !replacingKey ? (
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1">API Key</label>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-[var(--muted)]">••••••••</span>
                <button type="button" onClick={() => setReplacingKey(true)}
                  className="text-xs text-blue-400 hover:underline">
                  Replace
                </button>
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1">
                API Key {mode === 'edit' ? '(enter new key to replace)' : ''}
              </label>
              <input type="password" value={form.api_key} onChange={set('api_key')}
                placeholder={mode === 'edit' ? 'leave blank to keep existing' : 'optional'}
                className="w-full bg-[var(--panel-subtle)] border border-[var(--border-soft)] rounded px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--sel-bd)]" />
              {replacingKey && (
                <button type="button" onClick={() => { setReplacingKey(false); setForm((f) => ({ ...f, api_key: '' })) }}
                  className="text-xs text-[var(--muted)] mt-1 hover:underline">
                  Cancel
                </button>
              )}
            </div>
          )}
          <div className="flex gap-2 mt-2 justify-end">
            <button type="button" onClick={onClose}
              className="px-4 py-1.5 text-xs bg-[var(--panel-subtle)] border border-[var(--border-soft)] text-[var(--muted)] rounded hover:bg-[var(--panel)]">
              Cancel
            </button>
            <button type="submit"
              className="px-4 py-1.5 text-xs bg-[var(--sel-bg)] border border-[var(--sel-bd)] text-blue-400 rounded hover:bg-blue-500/20">
              {mode === 'add' ? 'Add' : 'Save'}
            </button>
          </div>
      </form>
    </AppModal>
  )
}

// ─── Codex auth modal ─────────────────────────────────────────────────────────

type CodexTab = 'device' | 'apikey'
type DeviceStep = 'idle' | 'starting' | 'waiting' | 'complete' | 'error'

function statusLabel(s: CodexAuthStatus | undefined) {
  if (!s) return { text: '—', cls: 'text-[var(--muted)]' }
  if (s.status === 'chatgpt') return { text: `ChatGPT${s.email ? ` · ${s.email}` : ''}`, cls: 'text-[var(--s-ok-tx)]' }
  if (s.status === 'api_key') return { text: 'API Key', cls: 'text-[var(--s-ok-tx)]' }
  if (s.status === 'unauthenticated') return { text: 'Not authenticated', cls: 'text-[var(--s-blk-tx)]' }
  return { text: s.raw || 'Unknown', cls: 'text-[var(--muted)]' }
}

function CodexAuthModal({ provider, onClose }: { provider: Provider; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<CodexTab>('device')
  const [deviceStep, setDeviceStep] = useState<DeviceStep>('idle')
  const [deviceUrl, setDeviceUrl] = useState<string | null>(null)
  const [deviceCode, setDeviceCode] = useState<string | null>(null)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [apiKeyError, setApiKeyError] = useState<string | null>(null)
  const [apiKeyOk, setApiKeyOk] = useState(false)
  const [copied, setCopied] = useState<'url' | 'code' | null>(null)
  const sessionRef = useRef<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: authStatus, isLoading } = useQuery({
    queryKey: ['codex-auth-status', provider.id],
    queryFn: () => fetchCodexAuthStatus(provider.id),
    refetchInterval: deviceStep === 'waiting' ? false : 30_000,
  })

  const invalidateStatus = () => queryClient.invalidateQueries({ queryKey: ['codex-auth-status', provider.id] })

  const stopPolling = () => {
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null }
  }

  const pollSession = (sessionId: string) => {
    pollRef.current = setTimeout(async () => {
      try {
        const result = await pollCodexDeviceAuth(provider.id, sessionId)
        if (result.status === 'complete') {
          setDeviceStep('complete')
          invalidateStatus()
        } else if (result.status === 'error') {
          setDeviceStep('error')
          setDeviceError(result.error ?? 'Auth failed')
        } else {
          pollSession(sessionId)
        }
      } catch {
        pollSession(sessionId)
      }
    }, 2_000)
  }

  const startDeviceAuth = async () => {
    setDeviceStep('starting')
    setDeviceError(null)
    setDeviceUrl(null)
    setDeviceCode(null)
    try {
      const result = await startCodexDeviceAuth(provider.id)
      if (result.already_authenticated || !result.url) {
        setDeviceStep('complete')
        invalidateStatus()
        return
      }
      sessionRef.current = result.session_id
      setDeviceUrl(result.url)
      setDeviceCode(result.code)
      setDeviceStep('waiting')
      pollSession(result.session_id)
    } catch (err) {
      setDeviceStep('error')
      setDeviceError(err instanceof Error ? err.message : 'Failed to start device auth')
    }
  }

  const handleApiKey = async () => {
    setApiKeyError(null)
    setApiKeyOk(false)
    const result = await codexApiKeyAuth(provider.id, apiKey)
    if (result.ok) {
      setApiKeyOk(true)
      invalidateStatus()
    } else {
      setApiKeyError(result.error ?? 'Auth failed')
    }
  }

  const handleLogout = async () => {
    await codexLogout(provider.id)
    invalidateStatus()
  }

  const copyUrl = () => {
    if (deviceUrl) { navigator.clipboard.writeText(deviceUrl); setCopied('url'); setTimeout(() => setCopied(null), 1500) }
  }
  const copyCode = () => {
    if (deviceCode) { navigator.clipboard.writeText(deviceCode); setCopied('code'); setTimeout(() => setCopied(null), 1500) }
  }

  useEffect(() => () => stopPolling(), [])

  const sl = statusLabel(authStatus)
  const isAuthed = authStatus?.status === 'chatgpt' || authStatus?.status === 'api_key'

  return (
    <AppModal
      open
      onClose={onClose}
      eyebrow="Providers"
      title={`Codex Auth · ${provider.name}`}
      tone={isAuthed ? 'running' : 'queued'}
      widthClassName="w-[min(760px,100%)]"
      heightClassName="h-[min(88vh,820px)]"
      bodyClassName="min-h-0 flex-1 overflow-y-auto bg-[var(--panel)] p-6"
    >

        {/* Header */}
        <div className="mb-5">
          <div className="text-sm font-semibold text-[var(--text)]">{provider.name}</div>
          <div className="mt-0.5 font-mono text-xs text-[var(--muted)]">{provider.base_url}</div>
        </div>

        {/* Current status */}
        <div className="mb-5 flex items-center justify-between rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-4 py-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)] mb-0.5">Auth status</div>
            <div className={`text-sm font-medium ${sl.cls}`}>
              {isLoading ? 'Checking…' : sl.text}
            </div>
          </div>
          {isAuthed && (
            <button onClick={handleLogout}
              className="text-xs font-mono text-[var(--muted)] hover:text-[var(--s-blk-tx)] border border-[var(--border-soft)] rounded px-2.5 py-1 hover:border-[var(--s-blk-bd)]">
              Logout
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-[var(--border-soft)] pb-0">
          {(['device', 'apikey'] as CodexTab[]).map((t) => (
            <button key={t} onClick={() => { setTab(t); setDeviceStep('idle'); setApiKeyError(null); setApiKeyOk(false) }}
              className={`px-3 py-1.5 font-mono text-xs uppercase tracking-wide border-b-2 -mb-px transition ${tab === t ? 'border-[var(--sel-bd)] text-blue-400' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}>
              {t === 'device' ? 'Device Auth' : 'API Key'}
            </button>
          ))}
        </div>

        {/* Device auth tab */}
        {tab === 'device' && (
          <div className="space-y-3">
            <p className="text-xs text-[var(--muted)]">
              Login with your OpenAI / ChatGPT account. A browser URL will appear — open it to complete authentication.
            </p>
            {deviceStep === 'idle' && (
              <button onClick={startDeviceAuth}
                className="w-full py-2 text-sm font-medium rounded border border-[var(--sel-bd)] bg-[var(--sel-bg)] text-blue-400 hover:bg-blue-500/20 transition">
                Start device auth
              </button>
            )}
            {deviceStep === 'starting' && (
              <div className="flex items-center gap-2 text-xs text-[var(--muted)] font-mono">
                <span className="inline-block h-2 w-2 rounded-full bg-[var(--s-run-bd)] animate-pulse" />
                Starting…
              </div>
            )}
            {(deviceStep === 'waiting' || deviceStep === 'complete') && deviceUrl && (
              <div className="space-y-3">
                {/* Step 1 — URL */}
                <div className="rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-2.5">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)] mb-1.5">1. Open this URL</div>
                  <div className="font-mono text-xs text-[var(--text)] break-all mb-2">{deviceUrl}</div>
                  <div className="flex gap-2">
                    <button onClick={copyUrl}
                      className="flex-1 py-1 text-xs font-mono rounded border border-[var(--border-soft)] text-[var(--muted)] hover:bg-[var(--panel)]">
                      {copied === 'url' ? 'Copied!' : 'Copy URL'}
                    </button>
                    <button onClick={() => window.open(deviceUrl, '_blank')}
                      className="flex-1 py-1 text-xs font-mono rounded border border-[var(--sel-bd)] text-blue-400 hover:bg-blue-500/20">
                      Open ↗
                    </button>
                  </div>
                </div>

                {/* Step 2 — One-time code */}
                {deviceCode && (
                  <div className="rounded border border-[var(--s-att-bd)] bg-[var(--s-att-bg)] px-3 py-2.5">
                    <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--s-att-tx)] mb-1.5">2. Enter this code</div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-2xl font-bold tracking-[0.25em] text-[var(--text)]">{deviceCode}</span>
                      <button onClick={copyCode}
                        className="shrink-0 px-3 py-1 text-xs font-mono rounded border border-[var(--s-att-bd)] text-[var(--s-att-tx)] hover:bg-[var(--s-att-bd)]/20">
                        {copied === 'code' ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                )}

                {deviceStep === 'waiting' && (
                  <div className="flex items-center gap-2 text-xs text-[var(--muted)] font-mono">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--s-run-bd)] animate-pulse" />
                    Waiting for you to complete login in the browser…
                  </div>
                )}
                {deviceStep === 'complete' && (
                  <div className="flex items-center gap-2 text-xs text-[var(--s-ok-tx)] font-mono">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--s-ok-bd)]" />
                    Authenticated successfully
                  </div>
                )}
              </div>
            )}
            {deviceStep === 'error' && (
              <div className="space-y-2">
                <div className="text-xs text-[var(--s-blk-tx)] font-mono">{deviceError}</div>
                <button onClick={() => setDeviceStep('idle')}
                  className="text-xs text-[var(--muted)] underline hover:text-[var(--text)]">Try again</button>
              </div>
            )}
          </div>
        )}

        {/* API key tab */}
        {tab === 'apikey' && (
          <div className="space-y-3">
            <p className="text-xs text-[var(--muted)]">
              Provide an OpenAI API key. It will be stored in the container's credential store, not in the database.
            </p>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
              className="w-full bg-[var(--panel-subtle)] border border-[var(--border-soft)] rounded px-3 py-2 font-mono text-sm text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--sel-bd)]"
            />
            {apiKeyError && <div className="text-xs text-[var(--s-blk-tx)] font-mono">{apiKeyError}</div>}
            {apiKeyOk && <div className="text-xs text-[var(--s-ok-tx)] font-mono">API key accepted</div>}
            <button
              onClick={handleApiKey}
              disabled={!apiKey.trim()}
              className="w-full py-2 text-sm font-medium rounded border border-[var(--sel-bd)] bg-[var(--sel-bg)] text-blue-400 hover:bg-blue-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition">
              Save API key
            </button>
          </div>
        )}

    </AppModal>
  )
}

// ─── Main Providers page ──────────────────────────────────────────────────────

export function Providers() {
  const { providers, isLoading, isError, create, update, remove } = useProviders()
  const [modal, setModal] = useState<{ mode: 'add' | 'edit'; provider?: Provider } | null>(null)
  const [authModal, setAuthModal] = useState<Provider | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleSubmit = (form: FormState) => {
    const payload: Omit<Provider, 'id' | 'created_at'> = {
      name: form.name, type: form.type, base_url: form.base_url,
      ...(form.model ? { model: form.model } : {}),
      ...(form.api_key ? { api_key: form.api_key } : {}),
      timeout_ms: form.timeout_ms,
    }
    if (modal?.mode === 'edit' && modal.provider) {
      update(modal.provider.id, payload)
    } else {
      create(payload)
    }
    setModal(null)
  }

  const handleDelete = (provider: Provider) => {
    if (deletingId === provider.id) { remove(provider.id); setDeletingId(null) }
    else setDeletingId(provider.id)
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm text-[var(--muted)]">Providers</h2>
        <button onClick={() => setModal({ mode: 'add' })}
          className="px-3 py-1.5 text-xs bg-[var(--sel-bg)] border border-[var(--sel-bd)] text-blue-400 rounded hover:bg-blue-500/20">
          + Add Provider
        </button>
      </div>

      {isError && <p className="text-[var(--s-blk-tx)] text-sm mb-3">Failed to load providers.</p>}

      {isLoading ? (
        <p className="text-[var(--muted)] text-sm">Loading…</p>
      ) : providers.length === 0 ? (
        <p className="text-[var(--muted)] text-sm">No providers configured yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="text-[var(--muted)] border-b border-[var(--border-soft)]">
                <th className="pb-2 pr-4 font-normal">Name</th>
                <th className="pb-2 pr-4 font-normal">Type</th>
                <th className="pb-2 pr-4 font-normal">Model</th>
                <th className="pb-2 pr-4 font-normal">Timeout</th>
                <th className="pb-2 pr-4 font-normal">Base URL</th>
                <th className="pb-2 pr-4 font-normal">Auth</th>
                <th className="pb-2 pr-4 font-normal">Created</th>
                <th className="pb-2 font-normal">Actions</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id} className="border-b border-[var(--border-soft)]/50 hover:bg-[var(--panel-subtle)]">
                  <td className="py-2 pr-4 text-[var(--text)] font-mono">{p.name}</td>
                  <td className="py-2 pr-4 text-[var(--muted)]">{p.type}</td>
                  <td className="py-2 pr-4">
                    <span className="text-[var(--muted)] font-mono">{p.model ?? '—'}</span>
                    {p.model && <ModelCapabilityBadge model={p.model} />}
                  </td>
                  <td className="py-2 pr-4 text-[var(--muted)] font-mono">{p.timeout_ms ?? 120000}</td>
                  <td className="py-2 pr-4 text-[var(--muted)] font-mono max-w-xs truncate">{p.base_url}</td>
                  <td className="py-2 pr-4">
                    {p.type === 'codex' ? (
                      <CodexAuthStatusBadge providerId={p.id} />
                    ) : p.api_key ? (
                      <span className="text-[var(--s-ok-tx)] font-mono">••••••</span>
                    ) : (
                      <span className="text-[var(--muted)]">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-[var(--muted)]">
                    {new Date(p.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-2">
                    <div className="flex gap-2 items-center">
                      {p.type === 'codex' && (
                        <button onClick={() => setAuthModal(p)}
                          className="px-2 py-1 text-xs bg-[var(--sel-bg)] border border-[var(--sel-bd)] text-blue-400 rounded hover:bg-blue-500/20">
                          Auth
                        </button>
                      )}
                      <button onClick={() => setModal({ mode: 'edit', provider: p })}
                        className="px-2 py-1 text-xs bg-[var(--panel-subtle)] border border-[var(--border-soft)] text-[var(--muted)] rounded hover:bg-[var(--panel)]">
                        Edit
                      </button>
                      {deletingId === p.id ? (
                        <>
                          <button onClick={() => handleDelete(p)}
                            className="px-2 py-1 text-xs bg-[var(--s-blk-bg)] border border-[var(--s-blk-bd)] text-[var(--s-blk-tx)] rounded">
                            Confirm
                          </button>
                          <button onClick={() => setDeletingId(null)}
                            className="px-2 py-1 text-xs bg-[var(--panel-subtle)] border border-[var(--border-soft)] text-[var(--muted)] rounded">
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button onClick={() => handleDelete(p)}
                          className="px-2 py-1 text-xs bg-[var(--panel-subtle)] border border-[var(--s-blk-bd)]/60 text-[var(--s-blk-tx)] rounded hover:bg-[var(--s-blk-bg)]">
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <ProviderModal mode={modal.mode} provider={modal.provider} onClose={() => setModal(null)} onSubmit={handleSubmit} />
      )}
      {authModal && (
        <CodexAuthModal provider={authModal} onClose={() => setAuthModal(null)} />
      )}
    </div>
  )
}

// ─── Model capability badge ──────────────────────────────────────────────────

function ModelCapabilityBadge({ model }: { model?: string }) {
  const [assessment, setAssessment] = useState<ModelCapabilityAssessment | null>(null)

  useEffect(() => {
    if (!model?.trim()) { setAssessment(null); return }
    fetchModelCapability(model).then(setAssessment).catch(() => setAssessment(null))
  }, [model])

  if (!assessment) return null
  if (assessment.tier === 'blocked') {
    return <span className="text-[var(--s-blk-tx)] font-mono text-[10px]" title={assessment.warning}>⛔ blocked</span>
  }
  if (assessment.tier === 'warned') {
    return <span className="text-amber-400 font-mono text-[10px]" title={assessment.warning}>⚠ {assessment.estimatedParams ?? '?'}B</span>
  }
  return null
}

// ─── Inline auth status badge for codex rows ──────────────────────────────────

function CodexAuthStatusBadge({ providerId }: { providerId: string }) {
  const { data } = useQuery({
    queryKey: ['codex-auth-status', providerId],
    queryFn: () => fetchCodexAuthStatus(providerId),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  if (!data) return <span className="text-[var(--muted)]">—</span>
  if (data.status === 'chatgpt') return <span className="text-[var(--s-ok-tx)]">ChatGPT</span>
  if (data.status === 'api_key') return <span className="text-[var(--s-ok-tx)]">API Key</span>
  return <span className="text-[var(--s-blk-tx)]">Not authed</span>
}
