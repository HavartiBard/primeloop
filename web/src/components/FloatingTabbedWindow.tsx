import type { ReactNode } from 'react'
import { Minus, X } from 'lucide-react'

export type FloatingTab = {
  id: string
  title: string
  tone?: 'default' | 'blocked' | 'running' | 'queued'
}

type FloatingTabbedWindowProps = {
  title: string
  tabs: FloatingTab[]
  activeTabId: string
  minimized?: boolean
  minimizedLabel?: string
  position: { x: number; y: number }
  size?: { width: number; height: number }
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onMinimize: () => void
  onRestore: () => void
  onClose: () => void
  onDragStart: (event: { clientX: number; clientY: number; preventDefault?: () => void }) => void
  onResizeStart?: (event: { clientX: number; clientY: number; preventDefault?: () => void }) => void
  children: ReactNode
}

function toneDotClass(tone?: FloatingTab['tone']): string {
  if (tone === 'blocked') return 'bg-rose-300'
  if (tone === 'running') return 'bg-cyan-300'
  if (tone === 'queued') return 'bg-blue-300'
  return 'bg-[var(--muted)]'
}

export function FloatingTabbedWindow({
  title,
  tabs,
  activeTabId,
  minimized = false,
  minimizedLabel,
  position,
  onSelectTab,
  onCloseTab,
  onMinimize,
  onRestore,
  onClose,
  onDragStart,
  onResizeStart,
  size,
  children,
}: FloatingTabbedWindowProps) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId)

  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      {minimized ? (
        <button
          type="button"
          onClick={onRestore}
          className="pointer-events-auto absolute bottom-4 left-4 inline-flex max-w-[320px] items-center gap-2 rounded-full border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_96%,black)] px-3 py-2 shadow-[0_16px_40px_rgba(0,0,0,0.35)] backdrop-blur-md transition hover:bg-[var(--panel-strong)]"
        >
          <span className={`h-2 w-2 rounded-full ${toneDotClass(activeTab?.tone)}`} />
          <span className="truncate font-mono text-[11px] text-[var(--text)]">{minimizedLabel ?? `${title} · ${activeTab?.title ?? ''}`}</span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--muted)]">{tabs.length}</span>
        </button>
      ) : (
        <div
          className="pointer-events-auto absolute overflow-hidden rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_97%,black)] shadow-[0_24px_80px_rgba(0,0,0,0.5)] backdrop-blur-md"
          style={{ left: position.x, top: position.y, width: size?.width ?? 520, height: size?.height ?? 540, maxWidth: 'calc(100% - 24px)', maxHeight: 'calc(100% - 24px)' }}
        >
          <div
            onMouseDown={onDragStart}
            className="flex cursor-move items-center justify-between gap-3 border-b border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] px-4 py-3"
          >
            <div className="min-w-0 flex-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">{title}</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onMinimize}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-soft)] text-[var(--muted)] transition hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
                aria-label="Minimize"
                title="Minimize"
              >
                <Minus size={14} />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-soft)] text-[var(--muted)] transition hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
                aria-label="Close"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="flex items-end gap-1 overflow-x-auto border-b border-white/8 bg-black/10 px-2 pt-2">
            {tabs.map((tab) => {
              const active = tab.id === activeTabId
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onSelectTab(tab.id)}
                  className={`group flex min-w-[140px] max-w-[220px] items-center gap-2 rounded-t-xl border border-b-0 px-3 py-2 text-left transition ${
                    active
                      ? 'border-white/12 bg-[var(--panel)] text-[var(--text)]'
                      : 'border-white/8 bg-white/5 text-[var(--muted)] hover:bg-white/8'
                  }`}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${toneDotClass(tab.tone)}`} />
                  <span className="truncate font-mono text-[11px]">{tab.title}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation()
                      onCloseTab(tab.id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        event.stopPropagation()
                        onCloseTab(tab.id)
                      }
                    }}
                    className="ml-auto rounded px-1 text-[10px] text-[var(--muted)] opacity-60 transition group-hover:opacity-100 hover:bg-white/10"
                  >
                    ×
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex h-[calc(100%-82px)] flex-col gap-3 overflow-y-auto px-4 py-4 text-sm text-[var(--text)]">
            {children}
          </div>
          {onResizeStart && (
            <button
              type="button"
              onMouseDown={onResizeStart}
              className="absolute bottom-0 right-0 h-5 w-5 cursor-se-resize bg-transparent"
              aria-label="Resize window"
              title="Resize window"
            >
              <span className="absolute bottom-1 right-1 h-2.5 w-2.5 border-b border-r border-white/35" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
