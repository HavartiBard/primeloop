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
    <aside className="hidden w-24 shrink-0 border-r border-[var(--border-soft)] bg-[var(--sidebar-bg)] px-2.5 py-3 lg:flex lg:flex-col lg:items-center lg:gap-2">
      <div className="flex w-full flex-col items-center rounded-2xl border border-[var(--border-soft)] bg-[var(--panel)] px-2 py-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-soft)] bg-[var(--panel-subtle)] text-[15px] font-semibold text-[var(--accent-strong)]">
          ACP
        </div>
        <div className="mt-2 text-center text-[9px] font-semibold uppercase leading-tight tracking-[0.18em] text-[var(--muted)]">Control</div>
      </div>
      {items.map((item) => (
        <button
          key={item.href}
          onClick={() => onNavigate(item.href)}
          title={item.label}
          className={`relative flex w-full flex-col items-center gap-1.5 rounded-2xl px-2 py-2.5 text-center transition ${
            current === item.href
              ? 'bg-[var(--panel-strong)] text-[var(--text)] shadow-[inset_0_0_0_1px_var(--border-soft)]'
              : 'text-[var(--muted)] hover:bg-[var(--panel-subtle)] hover:text-[var(--text)]'
          }`}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border-soft)] bg-[var(--panel-subtle)] text-[var(--muted)]">
            {item.icon}
          </span>
          <span className="max-w-full truncate text-[10px] font-semibold uppercase tracking-[0.08em]">{item.label}</span>
          {item.badge != null && item.badge > 0 && (
            <span className="absolute right-1.5 top-1.5 rounded-full border border-amber-400/20 bg-amber-400/12 px-1.5 py-0.5 text-[10px] text-amber-500">
              {item.badge}
            </span>
          )}
        </button>
      ))}
      <div className="mt-auto w-full rounded-2xl border border-[var(--border-soft)] bg-[var(--panel)] p-2">
        <button
          type="button"
          onClick={onToggleTheme}
          title={`Theme: ${theme === 'dark' ? 'Dark' : 'Light'}`}
          className="flex w-full flex-col items-center justify-center gap-1 rounded-xl border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text)] transition hover:bg-[var(--panel-strong)]"
        >
          <span className="text-base">{theme === 'dark' ? '◐' : '◑'}</span>
          <span className="text-[var(--muted)]">{theme === 'dark' ? 'Dark' : 'Light'}</span>
        </button>
      </div>
    </aside>
  )
}
