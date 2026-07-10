import { useEffect, useMemo, useState } from 'react'
import { getApiOrigin, readResponseBody } from '../../api'

// Detection-first QuickStart tier: scan the environment, ask only for a
// provider/model pick, prove it works with a live completion + tool-call
// test, then launch with defaults for everything else.

interface DetectedCloud {
  type: 'anthropic' | 'openai'
  env_key_present: boolean
}

interface DetectedLocal {
  type: string
  base_url: string
  label: string
  models: string[]
}

interface DetectResponse {
  cloud: DetectedCloud[]
  local: DetectedLocal[]
  default_model: string | null
  scanned_hosts: string[]
}

interface ProbeResult {
  completion_ok: boolean
  tool_call_ok: boolean
  latency_ms: number
  error?: string
  hint?: string
}

export interface QuickStartProvider {
  name: string
  type: string
  base_url: string
  api_key?: string
  model: string
}

const CLOUD_DEFAULTS: Record<string, { name: string; base_url: string; model: string; label: string }> = {
  anthropic: { name: 'anthropic-main', base_url: 'https://api.anthropic.com', model: 'claude-sonnet-4-6', label: 'Anthropic (Claude)' },
  openai: { name: 'openai-main', base_url: 'https://api.openai.com/v1', model: 'gpt-4o', label: 'OpenAI' },
}

const INPUT_CLS =
  'w-full rounded border border-[rgba(148,163,184,0.28)] bg-[#0f1b2d] px-3 py-2 text-sm font-medium text-[#ffffff] placeholder:text-[#b8c7de] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] focus:outline-none focus:border-[#6ee7ff] focus:bg-[#15243a]'
const BTN_PRIMARY =
  'px-4 py-2 text-sm font-medium rounded border border-[#6ee7ff] bg-[#1f6feb] text-white hover:bg-[#2b7fff] disabled:opacity-40 disabled:cursor-not-allowed transition'

type Selection =
  | { kind: 'local'; endpoint: DetectedLocal }
  | { kind: 'cloud'; type: 'anthropic' | 'openai' }

export function QuickStartSetup({ onLaunch, submitting, submitError, onAdvanced }: {
  onLaunch: (provider: QuickStartProvider) => void
  submitting: boolean
  submitError: string | null
  onAdvanced: () => void
}) {
  const [detecting, setDetecting] = useState(true)
  const [detectError, setDetectError] = useState<string | null>(null)
  const [detected, setDetected] = useState<DetectResponse | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [probe, setProbe] = useState<ProbeResult | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${getApiOrigin()}/api/setup/detect`)
      .then(async (res) => {
        const data = await readResponseBody<DetectResponse>(res) as DetectResponse | null
        if (cancelled) return
        if (!res.ok || !data) {
          setDetectError('Could not scan for providers — you can still configure one manually below.')
        } else {
          setDetected(data)
          // Preselect the best finding: a local endpoint with models beats a
          // cloud key, which beats an empty form.
          const firstLocal = data.local.find((e) => e.models.length > 0) ?? data.local[0]
          const cloudWithKey = data.cloud.find((c) => c.env_key_present)
          if (firstLocal) {
            setSelection({ kind: 'local', endpoint: firstLocal })
            setModel(data.default_model && firstLocal.models.includes(data.default_model) ? data.default_model : firstLocal.models[0] ?? '')
          } else if (cloudWithKey) {
            setSelection({ kind: 'cloud', type: cloudWithKey.type })
            setModel(CLOUD_DEFAULTS[cloudWithKey.type].model)
          }
        }
        setDetecting(false)
      })
      .catch(() => {
        if (cancelled) return
        setDetectError('Could not scan for providers — you can still configure one manually below.')
        setDetecting(false)
      })
    return () => { cancelled = true }
  }, [])

  const provider: QuickStartProvider | null = useMemo(() => {
    if (!selection || !model.trim()) return null
    if (selection.kind === 'local') {
      return {
        name: 'local-main',
        type: selection.endpoint.type,
        base_url: selection.endpoint.base_url,
        model: model.trim(),
      }
    }
    const defaults = CLOUD_DEFAULTS[selection.type]
    const envKeyPresent = detected?.cloud.find((c) => c.type === selection.type)?.env_key_present
    if (!envKeyPresent && !apiKey.trim()) return null
    return {
      name: defaults.name,
      type: selection.type,
      base_url: defaults.base_url,
      ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      model: model.trim(),
    }
  }, [selection, model, apiKey, detected])

  function select(next: Selection) {
    setSelection(next)
    setProbe(null)
    if (next.kind === 'local') {
      setModel(next.endpoint.models[0] ?? '')
    } else {
      setModel(CLOUD_DEFAULTS[next.type].model)
    }
  }

  async function runTest(): Promise<ProbeResult | null> {
    if (!provider) return null
    setTesting(true)
    setProbe(null)
    try {
      const res = await fetch(`${getApiOrigin()}/api/setup/provider-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(provider),
      })
      const data = await readResponseBody<ProbeResult>(res) as ProbeResult | null
      const result: ProbeResult = data && typeof data.completion_ok === 'boolean'
        ? data
        : { completion_ok: false, tool_call_ok: false, latency_ms: 0, error: `HTTP ${res.status}` }
      setProbe(result)
      return result
    } catch (err) {
      const result: ProbeResult = {
        completion_ok: false,
        tool_call_ok: false,
        latency_ms: 0,
        error: err instanceof Error ? err.message : 'Network error',
      }
      setProbe(result)
      return result
    } finally {
      setTesting(false)
    }
  }

  async function testAndLaunch() {
    if (!provider) return
    const result = probe?.completion_ok && probe.tool_call_ok ? probe : await runTest()
    if (result?.completion_ok && result.tool_call_ok) {
      onLaunch(provider)
    }
  }

  const testPassed = Boolean(probe?.completion_ok && probe?.tool_call_ok)
  const busy = testing || submitting

  return (
    <div className="space-y-4">
      {detecting && (
        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4 text-sm text-[var(--muted)]">
          Scanning for LLM providers on this machine…
        </div>
      )}

      {!detecting && (
        <>
          <p className="text-sm text-[var(--muted)]">
            {detected && detected.local.length > 0
              ? 'Found the following on this machine. Pick the model Prime should use — everything else starts with sensible defaults you can change later in Settings.'
              : 'No local LLM server was found. Use a cloud provider below, or start one (Ollama, LM Studio, vLLM) and re-run setup.'}
          </p>
          {detectError && <p className="text-xs text-amber-400">{detectError}</p>}

          <div className="space-y-2">
            {(detected?.local ?? []).map((endpoint) => {
              const active = selection?.kind === 'local' && selection.endpoint.base_url === endpoint.base_url
              return (
                <button
                  key={endpoint.base_url}
                  type="button"
                  onClick={() => select({ kind: 'local', endpoint })}
                  className={`w-full rounded-lg border p-3 text-left transition ${active ? 'border-[#6ee7ff] bg-[rgba(31,111,235,0.12)]' : 'border-[var(--border-soft)] bg-[var(--panel-subtle)] hover:border-[rgba(110,231,255,0.4)]'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-[var(--text)]">{endpoint.label}</span>
                    <span className="text-[10px] uppercase tracking-wide text-[var(--s-ok-tx)]">detected</span>
                  </div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    {endpoint.base_url} — {endpoint.models.length > 0 ? `${endpoint.models.length} model${endpoint.models.length === 1 ? '' : 's'}` : 'no models listed'}
                  </div>
                </button>
              )
            })}

            {(['anthropic', 'openai'] as const).map((type) => {
              const envKeyPresent = detected?.cloud.find((c) => c.type === type)?.env_key_present ?? false
              const active = selection?.kind === 'cloud' && selection.type === type
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => select({ kind: 'cloud', type })}
                  className={`w-full rounded-lg border p-3 text-left transition ${active ? 'border-[#6ee7ff] bg-[rgba(31,111,235,0.12)]' : 'border-[var(--border-soft)] bg-[var(--panel-subtle)] hover:border-[rgba(110,231,255,0.4)]'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-[var(--text)]">{CLOUD_DEFAULTS[type].label}</span>
                    {envKeyPresent && <span className="text-[10px] uppercase tracking-wide text-[var(--s-ok-tx)]">key detected</span>}
                  </div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    {envKeyPresent ? 'API key found in the server environment' : 'Requires an API key'}
                  </div>
                </button>
              )
            })}
          </div>

          {selection && (
            <div className="space-y-3 rounded-lg border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
              <div>
                <label className="mb-1 block text-xs text-[var(--muted)]">Model</label>
                {selection.kind === 'local' && selection.endpoint.models.length > 0 ? (
                  <select value={model} onChange={(e) => { setModel(e.target.value); setProbe(null) }} className={INPUT_CLS}>
                    {selection.endpoint.models.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                ) : (
                  <input value={model} onChange={(e) => { setModel(e.target.value); setProbe(null) }} className={INPUT_CLS} placeholder="model name" />
                )}
              </div>

              {selection.kind === 'cloud' && !(detected?.cloud.find((c) => c.type === selection.type)?.env_key_present) && (
                <div>
                  <label className="mb-1 block text-xs text-[var(--muted)]">API key</label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => { setApiKey(e.target.value); setProbe(null) }}
                    className={INPUT_CLS}
                    placeholder={selection.type === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
                  />
                </div>
              )}

              {probe && (
                <div className={`rounded border p-3 text-xs ${testPassed ? 'border-[rgba(16,185,129,0.4)] bg-[rgba(16,185,129,0.08)]' : 'border-amber-400/50 bg-amber-400/5'}`}>
                  <div className="flex gap-4">
                    <span className={probe.completion_ok ? 'text-[var(--s-ok-tx)]' : 'text-amber-400'}>
                      {probe.completion_ok ? '✓' : '✗'} completion
                    </span>
                    <span className={probe.tool_call_ok ? 'text-[var(--s-ok-tx)]' : 'text-amber-400'}>
                      {probe.tool_call_ok ? '✓' : '✗'} tool calling
                    </span>
                    {testPassed && <span className="text-[var(--muted)]">{(probe.latency_ms / 1000).toFixed(1)}s</span>}
                  </div>
                  {probe.error && <p className="mt-2 text-amber-400">{probe.error}</p>}
                  {probe.hint && <p className="mt-2 text-[var(--muted)]">{probe.hint}</p>}
                </div>
              )}

              {submitError && <p className="text-xs text-red-400">{submitError}</p>}

              <div className="flex items-center gap-3">
                <button type="button" onClick={testAndLaunch} disabled={!provider || busy} className={BTN_PRIMARY}>
                  {submitting ? 'Launching…' : testing ? 'Testing model (may take a while on first load)…' : testPassed ? 'Launch PrimeLoop →' : 'Test & launch →'}
                </button>
                {!testPassed && (
                  <button
                    type="button"
                    onClick={runTest}
                    disabled={!provider || busy}
                    className="text-xs text-[var(--muted)] underline hover:text-[var(--text)] disabled:opacity-40"
                  >
                    Test only
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="border-t border-[var(--border-soft)] pt-3 text-center">
            <button type="button" onClick={onAdvanced} className="text-xs text-[var(--muted)] underline hover:text-[var(--text)]">
              Need routing, personality, rules, or plugins up front? Use advanced setup
            </button>
          </div>
        </>
      )}
    </div>
  )
}
