import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useQuery, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ActivitySquare, Bot, BookOpen, CalendarClock, CircuitBoard, Library, MessageSquare, PuzzleIcon, Server, Settings as SettingsIcon, Sliders } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { FloatingTabbedWindow } from './components/FloatingTabbedWindow'
import type { NavItem } from './components/Sidebar'
import { CircuitView } from './pages/CircuitView'
import { OperationsPortal } from './pages/OperationsPortal'
import { Schedule } from './pages/Schedule'
import { Governance } from './pages/Governance'
import { Settings, type SettingsTabId } from './pages/Settings'
import { GoalList, GoalDetail } from './pages/goals'
import { ApprovalQueue } from './pages/approvals/ApprovalQueue'
import { LearningRecords } from './pages/learning/LearningRecords'
import { Catalog } from './pages/Catalog'
import { LoopPage } from './pages/prime/LoopPage'
import { useApprovals } from './hooks/useApprovals'
import { useSetupStatus } from './hooks/useSetupStatus.js'
import { Setup } from './pages/Setup.js'
import { abortPrimeSession, fetchPrimeProfile } from './api'
import { useQueryClient } from '@tanstack/react-query'
import { useLoopStatus } from './hooks/useLoopStatus'
import type { InspectorTabSnapshot } from './components/CollaborationRoomsView'

const queryClient = new QueryClient()

const ICON_SM = 'h-3.5 w-3.5'
const ICON_CLS = 'h-4 w-4'

const NAV: NavItem[] = [
  { label: 'Circuit',   icon: <CircuitBoard className={ICON_CLS} />, href: '/circuit' },
  { label: 'Rooms',     icon: <MessageSquare className={ICON_CLS} />, href: '/' },
  { label: 'Goals',     icon: <Bot className={ICON_CLS} />,           href: '/goals' },
  { label: 'Approvals', icon: <Server className={ICON_CLS} />,        href: '/approvals' },
  { label: 'Catalog',   icon: <Library className={ICON_CLS} />,       href: '/catalog' },
  { label: 'Schedule',  icon: <CalendarClock className={ICON_CLS} />, href: '/schedule' },
  { label: 'Settings',  icon: <SettingsIcon className={ICON_CLS} />,  href: '/settings' },
]

const PRIME_NAV: NavItem[] = [
  { label: 'Loop',     icon: <ActivitySquare className={ICON_SM} />, href: '/prime/loop' },
  { label: 'Learning', icon: <BookOpen className={ICON_SM} />,       href: '/learning' },
  { label: 'Sessions', icon: <MessageSquare className={ICON_SM} />,  href: '#', disabled: true },
  { label: 'Modules',  icon: <PuzzleIcon className={ICON_SM} />,     href: '#', disabled: true },
  { label: 'Config',   icon: <Sliders className={ICON_SM} />,        href: '/prime/config' },
]

const ALL_NAV = [...NAV, ...PRIME_NAV]

function LoopChip({ status }: { status: ReturnType<typeof useLoopStatus> }) {
  const { phase, label, isLlmPhase, elapsedSeconds, secondsLeft, currentSession } = status
  const [killing, setKilling] = useState(false)
  const qc = useQueryClient()

  const kill = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!currentSession || killing) return
    setKilling(true)
    try {
      await abortPrimeSession(currentSession.id)
      await qc.invalidateQueries({ queryKey: ['prime-loop-status-sessions'] })
    } catch { /* swallow — chip will update on next poll */ }
    finally { setKilling(false) }
  }, [currentSession, killing, qc])

  // Colour scheme: blue = pipeline work (no LLM), green = LLM active, amber = error, muted = idle
  const running = phase === 'running'
  const activeColor = running && isLlmPhase ? 'emerald' : running ? 'sky' : null

  const chipCls = running && isLlmPhase
    ? 'border-emerald-400/40 bg-emerald-400/8 text-emerald-300'
    : running
      ? 'border-sky-400/40 bg-sky-400/8 text-sky-300'
      : phase === 'error'
        ? 'border-amber-400/40 bg-amber-400/8 text-amber-300'
        : phase === 'stopped'
          ? 'border-[var(--border-soft)] bg-[var(--panel-subtle)] text-[var(--muted)] opacity-60'
          : 'border-[var(--border-soft)] bg-[var(--panel-subtle)] text-[var(--muted)]'

  const dotColor = running && isLlmPhase
    ? 'bg-emerald-400'
    : running
      ? 'bg-sky-400'
      : phase === 'error'
        ? 'bg-amber-400'
        : phase === 'stopped'
          ? 'bg-[var(--muted)]'
          : secondsLeft !== null && secondsLeft <= 10
            ? 'bg-emerald-300'
            : 'bg-emerald-400'

  const dot = running ? (
    <span className="relative flex h-2 w-2 flex-shrink-0">
      <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dotColor} opacity-60`} />
      <span className={`relative inline-flex h-2 w-2 rounded-full ${dotColor}`} />
    </span>
  ) : (
    <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dotColor}`} />
  )

  const timerCls = `font-mono tabular-nums text-[11px] ${
    running && isLlmPhase ? 'text-emerald-300/70'
    : running ? 'text-sky-300/70'
    : phase === 'error' ? 'text-amber-300/70'
    : secondsLeft !== null && secondsLeft <= 10 ? 'text-emerald-300'
    : 'text-[var(--muted)]'
  }`

  const elapsedStr = elapsedSeconds !== null
    ? `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`
    : null

  // suppress unused var warning
  void activeColor

  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${chipCls}`}>
      {dot}
      <span>Control loop</span>
      {running && (
        <>
          <span className="opacity-40">·</span>
          <span className="font-medium">{label}</span>
        </>
      )}
      {!running && phase === 'error' && (
        <>
          <span className="opacity-40">·</span>
          <span className="font-medium">Error</span>
          {secondsLeft !== null && (
            <span className={timerCls}>
              retry in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
            </span>
          )}
        </>
      )}
      {phase === 'stopped' && (
        <>
          <span className="opacity-40">·</span>
          <span className="font-medium">Stopped</span>
        </>
      )}
      {elapsedStr !== null ? (
        <span className={timerCls}>{elapsedStr}</span>
      ) : label && !running && phase !== 'error' ? (
        <span className={timerCls}>{label}</span>
      ) : null}
      {running && currentSession && (
        <button
          type="button"
          onClick={kill}
          disabled={killing}
          title="Kill this session"
          className={`ml-0.5 rounded px-1 text-[11px] opacity-50 hover:opacity-100 hover:text-rose-400 hover:bg-rose-400/10 transition disabled:opacity-30 ${isLlmPhase ? 'text-emerald-300' : 'text-sky-300'}`}
        >
          {killing ? '…' : '✕'}
        </button>
      )}
    </div>
  )
}

const INSPECTOR_WINDOW_KEY = 'global-inspector-window'
const PRIME_CONFIG_WINDOW_KEY = 'prime-config-window'
const DEFAULT_INSPECTOR_POSITION = { x: 96, y: 88 }
const DEFAULT_INSPECTOR_SIZE = { width: 620, height: 560 }
const DEFAULT_PRIME_CONFIG_POSITION = { x: 120, y: 96 }
const DEFAULT_PRIME_CONFIG_SIZE = { width: 960, height: 760 }

const THEMES = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'pcb', label: 'Circuit Board' },
] as const

type ThemeId = typeof THEMES[number]['id']

type GlobalInspectorState = {
  tabs: InspectorTabSnapshot[]
  activeTabId: string | null
  minimized: boolean
  position: { x: number; y: number }
  size: { width: number; height: number }
}

function inspectorTone(status: string): 'blocked' | 'running' | 'queued' | 'default' {
  if (status === 'blocked' || status === 'approval') return 'blocked'
  if (status === 'active' || status === 'running') return 'running'
  if (status === 'queued' || status === 'pending') return 'queued'
  return 'default'
}

function Layout() {
  const [page, setPage] = useState('/')
  const [theme, setTheme] = useState<ThemeId>(() => {
    if (typeof window === 'undefined') return 'dark'
    const stored = window.localStorage.getItem('agent-control-theme')
    return THEMES.some(t => t.id === stored) ? (stored as ThemeId) : 'dark'
  })
  const [inspectorState, setInspectorState] = useState<GlobalInspectorState>(() => {
    if (typeof window === 'undefined') {
      return { tabs: [], activeTabId: null, minimized: false, position: DEFAULT_INSPECTOR_POSITION, size: DEFAULT_INSPECTOR_SIZE }
    }
    try {
      const raw = window.localStorage.getItem(INSPECTOR_WINDOW_KEY)
      const saved = raw ? JSON.parse(raw) as Partial<GlobalInspectorState> : {}
      return {
        tabs: Array.isArray(saved.tabs) ? saved.tabs : [],
        activeTabId: typeof saved.activeTabId === 'string' ? saved.activeTabId : null,
        minimized: saved.minimized === true,
        position: {
          x: typeof saved.position?.x === 'number' ? saved.position.x : DEFAULT_INSPECTOR_POSITION.x,
          y: typeof saved.position?.y === 'number' ? saved.position.y : DEFAULT_INSPECTOR_POSITION.y,
        },
        size: {
          width: typeof saved.size?.width === 'number' ? saved.size.width : DEFAULT_INSPECTOR_SIZE.width,
          height: typeof saved.size?.height === 'number' ? saved.size.height : DEFAULT_INSPECTOR_SIZE.height,
        },
      }
    } catch {
      return { tabs: [], activeTabId: null, minimized: false, position: DEFAULT_INSPECTOR_POSITION, size: DEFAULT_INSPECTOR_SIZE }
    }
  })
  const [isDraggingInspector, setIsDraggingInspector] = useState(false)
  const [isResizingInspector, setIsResizingInspector] = useState(false)
  const [primeConfigOpen, setPrimeConfigOpen] = useState(false)
  const [primeConfigWindow, setPrimeConfigWindow] = useState(() => {
    if (typeof window === 'undefined') {
      return { minimized: false, position: DEFAULT_PRIME_CONFIG_POSITION, size: DEFAULT_PRIME_CONFIG_SIZE }
    }
    try {
      const raw = window.localStorage.getItem(PRIME_CONFIG_WINDOW_KEY)
      const saved = raw ? JSON.parse(raw) as Partial<{ minimized: boolean; position: { x: number; y: number }; size: { width: number; height: number } }> : {}
      return {
        minimized: saved.minimized === true,
        position: {
          x: typeof saved.position?.x === 'number' ? saved.position.x : DEFAULT_PRIME_CONFIG_POSITION.x,
          y: typeof saved.position?.y === 'number' ? saved.position.y : DEFAULT_PRIME_CONFIG_POSITION.y,
        },
        size: {
          width: typeof saved.size?.width === 'number' ? saved.size.width : DEFAULT_PRIME_CONFIG_SIZE.width,
          height: typeof saved.size?.height === 'number' ? saved.size.height : DEFAULT_PRIME_CONFIG_SIZE.height,
        },
      }
    } catch {
      return { minimized: false, position: DEFAULT_PRIME_CONFIG_POSITION, size: DEFAULT_PRIME_CONFIG_SIZE }
    }
  })
  const inspectorDragRef = useRef<{ offsetX: number; offsetY: number } | null>(null)
  const inspectorResizeRef = useRef<{ startX: number; startY: number; startWidth: number; startHeight: number } | null>(null)
  const [isDraggingPrimeConfig, setIsDraggingPrimeConfig] = useState(false)
  const [isResizingPrimeConfig, setIsResizingPrimeConfig] = useState(false)
  const primeConfigDragRef = useRef<{ offsetX: number; offsetY: number } | null>(null)
  const primeConfigResizeRef = useRef<{ startX: number; startY: number; startWidth: number; startHeight: number } | null>(null)
  const { approvals } = useApprovals()
  const loopStatus = useLoopStatus()

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

  useEffect(() => {
    window.localStorage.setItem(INSPECTOR_WINDOW_KEY, JSON.stringify(inspectorState))
  }, [inspectorState])

  useEffect(() => {
    window.localStorage.setItem(PRIME_CONFIG_WINDOW_KEY, JSON.stringify(primeConfigWindow))
  }, [primeConfigWindow])

  useEffect(() => {
    if (!isDraggingInspector) return
    const handleMove = (event: MouseEvent) => {
      const drag = inspectorDragRef.current
      if (!drag) return
      const nextX = Math.min(Math.max(12, event.clientX - drag.offsetX), Math.max(12, window.innerWidth - inspectorState.size.width - 12))
      const nextY = Math.min(Math.max(12, event.clientY - drag.offsetY), Math.max(12, window.innerHeight - inspectorState.size.height - 12))
      setInspectorState((current) => ({ ...current, position: { x: nextX, y: nextY } }))
    }
    const handleUp = () => {
      inspectorDragRef.current = null
      setIsDraggingInspector(false)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [inspectorState.size.height, inspectorState.size.width, isDraggingInspector])

  useEffect(() => {
    if (!isResizingInspector) return
    const handleMove = (event: MouseEvent) => {
      const resize = inspectorResizeRef.current
      if (!resize) return
      const nextWidth = Math.min(Math.max(420, resize.startWidth + (event.clientX - resize.startX)), window.innerWidth - inspectorState.position.x - 12)
      const nextHeight = Math.min(Math.max(320, resize.startHeight + (event.clientY - resize.startY)), window.innerHeight - inspectorState.position.y - 12)
      setInspectorState((current) => ({ ...current, size: { width: nextWidth, height: nextHeight } }))
    }
    const handleUp = () => {
      inspectorResizeRef.current = null
      setIsResizingInspector(false)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [inspectorState.position.x, inspectorState.position.y, isResizingInspector])

  const activeInspectorTab = inspectorState.activeTabId
    ? inspectorState.tabs.find((tab) => tab.id === inspectorState.activeTabId) ?? null
    : null

  const openInspector = useCallback((tab: InspectorTabSnapshot) => {
    setInspectorState((current) => {
      const existing = current.tabs.filter((entry) => entry.id !== tab.id)
      return {
        ...current,
        tabs: [...existing, tab],
        activeTabId: tab.id,
        minimized: false,
      }
    })
  }, [])

  const pageLabel = useMemo(() => {
    if (page === '/providers' || page === '/agents' || page === '/mcp-servers') return 'Settings'
    if (page.startsWith('/prime/')) return primeName
    return ALL_NAV.find((item) => item.href === page)?.label ?? 'Portal'
  }, [page, primeName])

  useEffect(() => {
    if (!isDraggingPrimeConfig) return
    const handleMove = (event: MouseEvent) => {
      const drag = primeConfigDragRef.current
      if (!drag) return
      const nextX = Math.min(Math.max(12, event.clientX - drag.offsetX), Math.max(12, window.innerWidth - primeConfigWindow.size.width - 12))
      const nextY = Math.min(Math.max(12, event.clientY - drag.offsetY), Math.max(12, window.innerHeight - primeConfigWindow.size.height - 12))
      setPrimeConfigWindow((current) => ({ ...current, position: { x: nextX, y: nextY } }))
    }
    const handleUp = () => {
      primeConfigDragRef.current = null
      setIsDraggingPrimeConfig(false)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [isDraggingPrimeConfig, primeConfigWindow.size.height, primeConfigWindow.size.width])

  useEffect(() => {
    if (!isResizingPrimeConfig) return
    const handleMove = (event: MouseEvent) => {
      const resize = primeConfigResizeRef.current
      if (!resize) return
      const width = Math.min(Math.max(720, resize.startWidth + (event.clientX - resize.startX)), window.innerWidth - primeConfigWindow.position.x - 12)
      const height = Math.min(Math.max(520, resize.startHeight + (event.clientY - resize.startY)), window.innerHeight - primeConfigWindow.position.y - 12)
      setPrimeConfigWindow((current) => ({ ...current, size: { width, height } }))
    }
    const handleUp = () => {
      primeConfigResizeRef.current = null
      setIsResizingPrimeConfig(false)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [isResizingPrimeConfig, primeConfigWindow.position.x, primeConfigWindow.position.y])

  const pendingApprovals = approvals.filter((a) => a.status === 'pending').length

  const settingsTab: SettingsTabId | undefined =
    page === '/providers'    ? 'providers'
    : page === '/agents'     ? 'agents'
    : page === '/mcp-servers' ? 'integrations'
    : undefined

  const handleNavigate = (href: string) => {
    if (href === '/prime/config') {
      setPrimeConfigOpen(true)
      setPrimeConfigWindow((current) => ({ ...current, minimized: false }))
      return
    }
    setPrimeConfigOpen(false)
    setPage(href)
  }

  useEffect(() => {
    if (!primeConfigOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPrimeConfigOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [primeConfigOpen])

  const beginPrimeConfigDrag = (event: { clientX: number; clientY: number; preventDefault?: () => void }) => {
    event.preventDefault?.()
    primeConfigDragRef.current = {
      offsetX: event.clientX - primeConfigWindow.position.x,
      offsetY: event.clientY - primeConfigWindow.position.y,
    }
    setIsDraggingPrimeConfig(true)
  }

  const beginPrimeConfigResize = (event: { clientX: number; clientY: number; preventDefault?: () => void }) => {
    event.preventDefault?.()
    primeConfigResizeRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startWidth: primeConfigWindow.size.width,
      startHeight: primeConfigWindow.size.height,
    }
    setIsResizingPrimeConfig(true)
  }

  const Page =
    page === '/'             ? OperationsPortal
    : page.startsWith('/goals/') ? GoalDetail
    : page === '/goals'      ? GoalList
    : page === '/approvals'  ? ApprovalQueue
    : page === '/catalog'    ? Catalog
    : page === '/learning'   ? LearningRecords
    : page === '/prime/loop' ? LoopPage
    : page === '/schedule'   ? Schedule
    : page === '/governance' ? Governance
    : (page === '/settings' || settingsTab != null) ? () => <Settings defaultTab={settingsTab} />
    : OperationsPortal

  const selectInspectorTab = (id: string) => {
    setInspectorState((current) => ({ ...current, activeTabId: id }))
  }

  const closeInspectorTab = (id: string) => {
    setInspectorState((current) => {
      const tabs = current.tabs.filter((tab) => tab.id !== id)
      return {
        ...current,
        tabs,
        activeTabId: current.activeTabId === id ? (tabs[tabs.length - 1]?.id ?? null) : current.activeTabId,
        minimized: tabs.length === 0 ? false : current.minimized,
      }
    })
  }

  const beginInspectorDrag = (event: { clientX: number; clientY: number; preventDefault?: () => void }) => {
    event.preventDefault?.()
    inspectorDragRef.current = {
      offsetX: event.clientX - inspectorState.position.x,
      offsetY: event.clientY - inspectorState.position.y,
    }
    setIsDraggingInspector(true)
  }

  const beginInspectorResize = (event: { clientX: number; clientY: number; preventDefault?: () => void }) => {
    event.preventDefault?.()
    inspectorResizeRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startWidth: inspectorState.size.width,
      startHeight: inspectorState.size.height,
    }
    setIsResizingInspector(true)
  }

  return (
    <div className="app-shell flex min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <Sidebar
        items={NAV}
        primeItems={PRIME_NAV}
        primeName={primeName}
        current={page}
        onNavigate={handleNavigate}
        theme={theme}
        primeConfigOpen={primeConfigOpen}
        onToggleTheme={() => {
          const currentIndex = THEMES.findIndex(t => t.id === theme)
          const nextIndex = (currentIndex + 1) % THEMES.length
          setTheme(THEMES[nextIndex].id)
        }}
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
                  <span className={`inline-flex min-w-5 justify-center rounded-full px-1.5 py-0.5 text-[11px] ${pendingApprovals > 0 ? 'bg-amber-400/20 text-amber-300' : 'bg-emerald-400/15 text-emerald-300'}`}>
                    {pendingApprovals}
                  </span>
                  Pending approvals
                </div>
                <LoopChip status={loopStatus} />
              </div>
            </div>
            <div className="flex items-center gap-2 lg:hidden">
              <button
                type="button"
                onClick={() => {
                  const currentIndex = THEMES.findIndex(t => t.id === theme)
                  const nextIndex = (currentIndex + 1) % THEMES.length
                  setTheme(THEMES[nextIndex].id)
                }}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 text-sm text-[var(--text)] transition hover:bg-[var(--panel-strong)]"
                title="Cycle themes"
              >
                <span className="text-base">🎨</span>
                <span className="hidden sm:inline">{THEMES.find(t => t.id === theme)?.label}</span>
              </button>
              <button
                type="button"
                onClick={() => setPage('/settings')}
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
                onClick={() => handleNavigate(item.href)}
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
          ? <CircuitView onNavigate={handleNavigate} />
          : page === '/'
            ? <OperationsPortal onOpenInspector={openInspector} activeInspectorId={inspectorState.activeTabId} />
            : <Page />
        }
      </main>
      {primeConfigOpen && (
        <FloatingTabbedWindow
          title="Prime"
          tabs={[{ id: 'prime-config', title: 'Prime Agent Config', tone: 'running' }]}
          activeTabId="prime-config"
          minimized={primeConfigWindow.minimized}
          minimizedLabel="Prime · Config"
          position={primeConfigWindow.position}
          size={primeConfigWindow.size}
          onSelectTab={() => {}}
          onCloseTab={() => setPrimeConfigOpen(false)}
          onMinimize={() => setPrimeConfigWindow((current) => ({ ...current, minimized: true }))}
          onRestore={() => setPrimeConfigWindow((current) => ({ ...current, minimized: false }))}
          onClose={() => setPrimeConfigOpen(false)}
          onDragStart={beginPrimeConfigDrag}
          onResizeStart={beginPrimeConfigResize}
        >
          <Governance embedded />
        </FloatingTabbedWindow>
      )}
      {activeInspectorTab && inspectorState.tabs.length > 0 && (
        <FloatingTabbedWindow
          title="Inspector"
          tabs={inspectorState.tabs.map((tab) => ({ id: tab.id, title: tab.title, tone: inspectorTone(tab.status) }))}
          activeTabId={inspectorState.activeTabId ?? inspectorState.tabs[0]?.id ?? ''}
          minimized={inspectorState.minimized}
          minimizedLabel={`Inspector · ${activeInspectorTab.title}`}
          position={inspectorState.position}
          size={inspectorState.size}
          onSelectTab={selectInspectorTab}
          onCloseTab={closeInspectorTab}
          onMinimize={() => setInspectorState((current) => ({ ...current, minimized: true }))}
          onRestore={() => setInspectorState((current) => ({ ...current, minimized: false }))}
          onClose={() => setInspectorState((current) => ({ ...current, tabs: [], activeTabId: null, minimized: false }))}
          onDragStart={beginInspectorDrag}
          onResizeStart={beginInspectorResize}
        >
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-[var(--text)]">{activeInspectorTab.title}</div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">{activeInspectorTab.kind}</div>
          </div>
          <div className="grid grid-cols-[108px_minmax(0,1fr)_108px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
            <span className="text-[var(--muted)]">Owner</span><span className="truncate">{activeInspectorTab.owner}</span>
            <span className="text-[var(--muted)]">Status</span><span>{activeInspectorTab.status}</span>
            <span className="text-[var(--muted)]">Created</span><span>{activeInspectorTab.createdAt ?? ''}</span>
            <span className="text-[var(--muted)]">Updated</span><span>{activeInspectorTab.updatedAt ?? ''}</span>
            <span className="text-[var(--muted)]">External Ticket</span><span className="col-span-3 break-all">{activeInspectorTab.externalTicket ?? ''}</span>
          </div>
          {activeInspectorTab.details && (
            <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Details</div>
              <div className="whitespace-pre-wrap break-words text-sm text-[var(--text)]">{activeInspectorTab.details}</div>
            </div>
          )}
          {activeInspectorTab.request && (
            <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Request</div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--border-soft)] bg-black/20 p-3 font-mono text-[11px] text-[var(--text)]">{activeInspectorTab.request}</pre>
            </div>
          )}
          {activeInspectorTab.result && (
            <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Result</div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--border-soft)] bg-black/20 p-3 font-mono text-[11px] text-[var(--text)]">{activeInspectorTab.result}</pre>
            </div>
          )}
          {activeInspectorTab.metadata && (
            <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Metadata</div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--border-soft)] bg-black/20 p-3 font-mono text-[11px] text-[var(--text)]">{activeInspectorTab.metadata}</pre>
            </div>
          )}
        </FloatingTabbedWindow>
      )}
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
        initialSetupStatus={setupStatus}
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
