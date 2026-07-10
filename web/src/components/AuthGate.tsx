import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getApiOrigin } from '../api'

// Sign-in gate for installs with PRIMELOOP_ADMIN_TOKEN set. Auth rides on an
// httpOnly session cookie, so every existing fetch in the app works unchanged
// once the user has signed in.

export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['auth-status'],
    queryFn: async () => {
      const res = await fetch(`${getApiOrigin()}/api/auth/status`, { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json() as Promise<{ required: boolean; authenticated: boolean }>
    },
    retry: 1,
    staleTime: 60_000,
  })
  const [token, setToken] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-soft)] border-t-[var(--accent)]" />
      </div>
    )
  }

  if (!data || !data.required || data.authenticated) {
    return <>{children}</>
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    if (!token.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`${getApiOrigin()}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token: token.trim() }),
      })
      if (res.ok) {
        await queryClient.invalidateQueries()
      } else {
        setError(res.status === 401 ? 'Invalid token' : `Sign-in failed (HTTP ${res.status})`)
      }
    } catch {
      setError('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4">
      <form onSubmit={signIn} className="w-full max-w-sm space-y-4 rounded-lg border border-[var(--border-soft)] bg-[var(--panel)] p-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)]">PrimeLoop</div>
          <h1 className="mt-1 text-lg font-semibold text-[var(--text)]">Sign in</h1>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
            Enter the access token from this install&apos;s <code>.env</code> file
            (<code>PRIMELOOP_ADMIN_TOKEN</code>).
          </p>
        </div>
        <input
          type="password"
          autoFocus
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="access token"
          className="w-full rounded border border-[rgba(148,163,184,0.28)] bg-[#0f1b2d] px-3 py-2 text-sm font-medium text-[#ffffff] placeholder:text-[#b8c7de] focus:outline-none focus:border-[#6ee7ff]"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={!token.trim() || submitting}
          className="w-full rounded border border-[#6ee7ff] bg-[#1f6feb] px-4 py-2 text-sm font-medium text-white hover:bg-[#2b7fff] disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
