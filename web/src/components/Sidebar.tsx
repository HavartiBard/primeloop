import type { ReactNode } from 'react'

interface NavItem {
  label: string
  icon: ReactNode
  href: string
  badge?: number
}

interface Props {
  items: NavItem[]
  current: string
  onNavigate: (href: string) => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
}

export function Sidebar({ items, current, onNavigate, theme, onToggleTheme }: Props) {
  return (
    <aside className="hidden w-56 shrink-0 border-r border-[var(--border-soft)] bg-[var(--sidebar-bg)] p-3 lg:flex lg:flex-col lg:gap-2">
      <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--panel)] p-3">
        <div className="text-[10px] font-semibold tracking-[0.32em] text-[var(--accent-strong)]">AGENT CONTROL</div>
        <div className="mt-2 text-lg font-semibold tracking-tight text-[var(--text)]">Chief Desk</div>
      </div>
      {items.map((item) => (
        <button
          key={item.href}
          onClick={() => onNavigate(item.href)}
          className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm transition ${
            current === item.href
              ? 'bg-[var(--panel-strong)] text-[var(--text)] shadow-[inset_0_0_0_1px_var(--border-soft)]'
              : 'text-[var(--muted)] hover:bg-[var(--panel-subtle)] hover:text-[var(--text)]'
          }`}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border-soft)] bg-[var(--panel-subtle)] text-[var(--muted)]">
            {item.icon}
          </span>
          <span className="min-w-0 flex-1 font-medium">{item.label}</span>
          {item.badge != null && item.badge > 0 && (
            <span className="rounded-full border border-amber-400/20 bg-amber-400/12 px-2 py-0.5 text-xs text-amber-500">
              {item.badge}
            </span>
          )}
        </button>
      ))}
      <div className="mt-auto rounded-2xl border border-[var(--border-soft)] bg-[var(--panel)] p-3">
        <button
          type="button"
          onClick={onToggleTheme}
          className="flex w-full items-center justify-between rounded-xl border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-2 text-sm text-[var(--text)] transition hover:bg-[var(--panel-strong)]"
        >
          <span>Theme</span>
          <span className="text-[var(--muted)]">{theme === 'dark' ? 'Dark' : 'Light'}</span>
        </button>
      </div>
    </aside>
  )
}
