import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Bot, CalendarClock, CircuitBoard, MessageSquare, Server } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { CircuitView } from './pages/CircuitView'
import { OperationsPortal } from './pages/OperationsPortal'
import { Schedule } from './pages/Schedule'
import { Agents } from './pages/Agents'
import { McpServers } from './pages/McpServers'
import { Providers } from './pages/Providers'
import { Governance } from './pages/Governance'
import { useApprovals } from './hooks/useApprovals'
import { useSetupStatus } from './hooks/useSetupStatus.js'
import { Setup } from './pages/Setup.js'

const queryClient = new QueryClient()

interface NavItem {
  label: string
  icon: ReactNode
  href: string
  badge?: number
}

const ICON_CLS = 'h-5 w-5'

const NAV: NavItem[] = [
  { label: 'Circuit',  icon: <CircuitBoard className={ICON_CLS} />, href: '/circuit' },
  { label: 'Rooms',    icon: <MessageSquare className={ICON_CLS} />, href: '/' },
  { label: 'Schedule', icon: <CalendarClock className={ICON_CLS} />, href: '/schedule' },
  { label: 'Agents',   icon: <Bot className={ICON_CLS} />,          href: '/agents' },
  { label: 'MCP',      icon: <Server className={ICON_CLS} />,       href: '/mcp-servers' },
  { label: 'Providers',icon: <Server className={ICON_CLS} />,        href: '/providers' },
]

function Layout() {
  const [page, setPage] = useState('/')
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark'
    const stored = window.localStorage.getItem('agent-control-theme')
    return stored === 'light' ? 'light' : 'dark'
  })
  const { approvals } = useApprovals()

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('agent-control-theme', theme)
  }, [theme])

  const navItems = NAV

  const pageLabel = useMemo(
    () => navItems.find((item) => item.href === page)?.label ?? 'Portal',
    [navItems, page]
  )

  const pendingApprovals = approvals.filter((a) => a.status === 'pending').length

  const Page =
    page === '/circuit' ? CircuitView
    : page === '/' ? OperationsPortal
    : page === '/schedule' ? Schedule
    : page === '/agents' ? Agents
    : page === '/mcp-servers' ? McpServers
    : page === '/governance' ? Governance
    : Providers

  return (
    <div className="app-shell flex min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <Sidebar
        items={navItems}
        current={page}
        onNavigate={setPage}
        theme={theme}
        onToggleTheme={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')}
      />
      <main className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-30 border-b border-[var(--border-soft)] bg-[var(--topbar-bg)] px-3 py-2.5 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--muted)]">
                {pageLabel}
              </div>
              <div className="hidden items-center gap-2 md:flex">
                <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-1 text-xs text-[var(--muted)]">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  Control loop
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-1 text-xs text-[var(--muted)]">
                  <span className={`inline-flex min-w-5 justify-center rounded-full px-1.5 py-0.5 text-[11px] ${pendingApprovals > 0 ? 'bg-amber-400/20 text-amber-300' : 'bg-emerald-400/15 text-emerald-300'}`}>
                    {pendingApprovals}
                  </span>
                  Pending approvals
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 text-sm text-[var(--text)] transition hover:bg-[var(--panel-strong)]"
              >
                <span className="text-base">{theme === 'dark' ? '◐' : '◑'}</span>
                <span className="hidden sm:inline">{theme === 'dark' ? 'Dark' : 'Light'}</span>
              </button>
              <button
                type="button"
                onClick={() => setPage('/governance')}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 text-sm text-[var(--text)] transition hover:bg-[var(--panel-strong)]"
              >
                <span className="text-base">⌘</span>
                <span className="hidden sm:inline">Settings</span>
              </button>
            </div>
          </div>
        </div>

        {/* Mobile tab strip */}
        <div className="border-b border-[var(--border-soft)] bg-[var(--topbar-bg)] px-3 py-2 backdrop-blur lg:hidden">
          <div className="flex gap-2 overflow-x-auto">
            {navItems.map((item) => (
              <button
                key={item.href}
                onClick={() => setPage(item.href)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition ${
                  page === item.href
                    ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--text)]'
                    : 'border-[var(--border-soft)] bg-[var(--panel-subtle)] text-[var(--muted)]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {page === '/circuit'
          ? <CircuitView onNavigate={setPage} />
          : <Page />
        }
      </main>
    </div>
  )
}

function AppInner() {
  const { data: setupStatus, isLoading } = useSetupStatus()
  const [skipped, setSkipped] = useState(
    () => sessionStorage.getItem('setup-skipped') === '1'
  )

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-soft)] border-t-[var(--accent)]" />
      </div>
    )
  }

  if (!setupStatus?.complete && !skipped) {
    return (
      <Setup
        onSkip={() => {
          sessionStorage.setItem('setup-skipped', '1')
          setSkipped(true)
        }}
      />
    )
  }

  return <Layout />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInner />
    </QueryClientProvider>
  )
}
