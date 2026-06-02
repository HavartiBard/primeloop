import { useEffect, useMemo, useState } from 'react'
import { useQuery, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ActivitySquare, Bot, BookOpen, CalendarClock, CircuitBoard, MessageSquare, PuzzleIcon, Server, Settings as SettingsIcon, Sliders } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import type { NavItem } from './components/Sidebar'
import { CircuitView } from './pages/CircuitView'
import { OperationsPortal } from './pages/OperationsPortal'
import { Schedule } from './pages/Schedule'
import { Governance } from './pages/Governance'
import { Settings, type SettingsTabId } from './pages/Settings'
import { GoalList, GoalDetail } from './pages/goals'
import { ApprovalQueue } from './pages/approvals/ApprovalQueue'
import { LearningRecords } from './pages/learning/LearningRecords'
import { LoopPage } from './pages/prime/LoopPage'
import { useApprovals } from './hooks/useApprovals'
import { useSetupStatus } from './hooks/useSetupStatus.js'
import { Setup } from './pages/Setup.js'
import { fetchPrimeProfile } from './api'

const queryClient = new QueryClient()

const ICON_SM = 'h-3.5 w-3.5'
const ICON_CLS = 'h-4 w-4'

const NAV: NavItem[] = [
  { label: 'Circuit',   icon: <CircuitBoard className={ICON_CLS} />, href: '/circuit' },
  { label: 'Rooms',     icon: <MessageSquare className={ICON_CLS} />, href: '/' },
  { label: 'Goals',     icon: <Bot className={ICON_CLS} />,           href: '/goals' },
  { label: 'Approvals', icon: <Server className={ICON_CLS} />,        href: '/approvals' },
  { label: 'Schedule',  icon: <CalendarClock className={ICON_CLS} />, href: '/schedule' },
  { label: 'Settings',  icon: <SettingsIcon className={ICON_CLS} />,  href: '/settings' },
]

const PRIME_NAV: NavItem[] = [
  { label: 'Loop',     icon: <ActivitySquare className={ICON_SM} />, href: '/prime/loop' },
  { label: 'Learning', icon: <BookOpen className={ICON_SM} />,       href: '/learning' },
  { label: 'Sessions', icon: <MessageSquare className={ICON_SM} />,  href: '#', disabled: true },
  { label: 'Modules',  icon: <PuzzleIcon className={ICON_SM} />,     href: '#', disabled: true },
  { label: 'Config',   icon: <Sliders className={ICON_SM} />,        href: '#', disabled: true },
]

const ALL_NAV = [...NAV, ...PRIME_NAV]

function Layout() {
  const [page, setPage] = useState('/')
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark'
    const stored = window.localStorage.getItem('agent-control-theme')
    return stored === 'light' ? 'light' : 'dark'
  })
  const { approvals } = useApprovals()

  const { data: primeProfile } = useQuery({
    queryKey: ['prime-profile'],
    queryFn: fetchPrimeProfile,
    staleTime: 5 * 60 * 1000,
  })
  const primeName = primeProfile?.name?.trim() || 'Prime'

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('agent-control-theme', theme)
  }, [theme])

  const pageLabel = useMemo(() => {
    if (page === '/providers' || page === '/agents' || page === '/mcp-servers') return 'Settings'
    if (page.startsWith('/prime/')) return primeName
    return ALL_NAV.find((item) => item.href === page)?.label ?? 'Portal'
  }, [page, primeName])

  const pendingApprovals = approvals.filter((a) => a.status === 'pending').length

  const settingsTab: SettingsTabId | undefined =
    page === '/providers'    ? 'providers'
    : page === '/agents'     ? 'agents'
    : page === '/mcp-servers' ? 'integrations'
    : undefined

  const Page =
    page === '/'             ? OperationsPortal
    : page.startsWith('/goals/') ? GoalDetail
    : page === '/goals'      ? GoalList
    : page === '/approvals'  ? ApprovalQueue
    : page === '/learning'   ? LearningRecords
    : page === '/prime/loop' ? LoopPage
    : page === '/schedule'   ? Schedule
    : page === '/governance' ? Governance
    : (page === '/settings' || settingsTab != null) ? () => <Settings defaultTab={settingsTab} />
    : OperationsPortal

  return (
    <div className="app-shell flex min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <Sidebar
        items={NAV}
        primeItems={PRIME_NAV}
        primeName={primeName}
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
                <SettingsIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Settings</span>
              </button>
            </div>
          </div>
        </div>

        {/* Mobile tab strip — flat list of all navigable items */}
        <div className="border-b border-[var(--border-soft)] bg-[var(--topbar-bg)] px-3 py-2 backdrop-blur lg:hidden">
          <div className="flex gap-2 overflow-x-auto">
            {ALL_NAV.filter((item) => !item.disabled).map((item) => (
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
  const forceSetup = new URLSearchParams(window.location.search).get('setup') === '1'
  const [skipped, setSkipped] = useState(
    () => sessionStorage.getItem('setup-skipped') === '1'
  )
  const effectiveSkipped = forceSetup ? false : skipped

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-soft)] border-t-[var(--accent)]" />
      </div>
    )
  }

  if ((forceSetup || !setupStatus?.complete) && !effectiveSkipped) {
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
