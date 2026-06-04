import type { ReactNode } from 'react'
import { X } from 'lucide-react'

type AppModalProps = {
  open: boolean
  title: string
  eyebrow?: string
  tone?: 'default' | 'running' | 'blocked' | 'queued'
  onClose: () => void
  children: ReactNode
  widthClassName?: string
  heightClassName?: string
  bodyClassName?: string
}

function toneDotClass(tone: AppModalProps['tone']): string {
  if (tone === 'blocked') return 'bg-rose-300'
  if (tone === 'running') return 'bg-cyan-300'
  if (tone === 'queued') return 'bg-blue-300'
  return 'bg-[var(--muted)]'
}

export function AppModal({
  open,
  title,
  eyebrow = 'Panel',
  tone = 'default',
  onClose,
  children,
  widthClassName = 'w-[min(1100px,100%)]',
  heightClassName = 'h-[min(90vh,920px)]',
  bodyClassName = 'min-h-0 flex-1 overflow-hidden bg-[var(--panel)]',
}: AppModalProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`flex ${heightClassName} ${widthClassName} flex-col overflow-hidden rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_97%,black)] shadow-[0_24px_80px_rgba(0,0,0,0.5)]`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] px-4 py-3">
          <div className="min-w-0 flex-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">{eyebrow}</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-soft)] text-[var(--muted)] transition hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
              aria-label={`Close ${title}`}
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex items-end gap-1 overflow-x-auto border-b border-white/8 bg-black/10 px-2 pt-2">
          <div className="flex min-w-[160px] max-w-[240px] items-center gap-2 rounded-t-xl border border-b-0 border-white/12 bg-[var(--panel)] px-3 py-2 text-left text-[var(--text)]">
            <span className={`h-2 w-2 shrink-0 rounded-full ${toneDotClass(tone)}`} />
            <span className="truncate font-mono text-[11px]">{title}</span>
          </div>
        </div>
        <div className={bodyClassName}>{children}</div>
      </div>
    </div>
  )
}
