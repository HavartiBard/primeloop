import { useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

export interface NavItem {
  label: string
  icon: ReactNode
  href: string
  badge?: number
  disabled?: boolean
}

interface Props {
  items: NavItem[]
  primeItems: NavItem[]
  primeName: string
  current: string
  onNavigate: (href: string) => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
}

const PRIME_EXPANDED_KEY = 'prime-nav-expanded'

export function Sidebar({ items, primeItems, primeName, current, onNavigate, theme, onToggleTheme }: Props) {
  const [primeExpanded, setPrimeExpanded] = useState(() => {
    if (typeof window === 'undefined') return true
    const stored = window.localStorage.getItem(PRIME_EXPANDED_KEY)
    return stored !== 'false'
  })

  useEffect(() => {
    window.localStorage.setItem(PRIME_EXPANDED_KEY, String(primeExpanded))
  }, [primeExpanded])

  // Auto-expand when a prime sub-item is active
  useEffect(() => {
    if (primeItems.some((item) => current === item.href || current.startsWith(item.href + '/'))) {
      setPrimeExpanded(true)
    }
  }, [current, primeItems])

  return (
    <aside className="hidden w-48 shrink-0 border-r border-[var(--border-soft)] bg-[var(--sidebar-bg)] px-2 py-3 lg:flex lg:flex-col lg:gap-0.5">
      {/* Logo */}
      <div className="mb-2 flex items-center gap-2.5 rounded-xl border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--border-soft)] bg-[var(--panel-subtle)] text-[11px] font-bold text-[var(--accent-strong)]">
          ACP
        </div>
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--muted)]">Control</span>
      </div>

      {/* Main nav */}
      {items.map((item) => (
        <NavButton key={item.href} item={item} current={current} onNavigate={onNavigate} />
      ))}

      {/* Divider */}
      <div className="mx-1 my-1.5 h-px bg-[var(--border-soft)]" />

      {/* Prime Agent group */}
      <button
        type="button"
        onClick={() => setPrimeExpanded((v) => !v)}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left transition hover:bg-[var(--panel-subtle)]"
      >
        <span className="flex-1 truncate text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--accent-strong)]">
          {primeName}
        </span>
        {primeExpanded
          ? <ChevronDown className="h-3 w-3 shrink-0 text-[var(--muted)]" />
          : <ChevronRight className="h-3 w-3 shrink-0 text-[var(--muted)]" />
        }
      </button>

      {primeExpanded && (
        <div className="flex flex-col gap-0.5 pl-2">
          {primeItems.map((item) => (
            <NavButton key={item.href} item={item} current={current} onNavigate={onNavigate} sub />
          ))}
        </div>
      )}

      {/* Theme toggle */}
      <div className="mt-auto pt-2">
        <div className="mx-1 mb-2 h-px bg-[var(--border-soft)]" />
        <button
          type="button"
          onClick={onToggleTheme}
          title={`Theme: ${theme === 'dark' ? 'Dark' : 'Light'}`}
          className="flex w-full items-center gap-2.5 rounded-xl border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--panel-strong)]"
        >
          <span className="text-base leading-none">{theme === 'dark' ? '◐' : '◑'}</span>
          <span className="text-[var(--muted)]">{theme === 'dark' ? 'Dark' : 'Light'}</span>
        </button>
      </div>
    </aside>
  )
}

function NavButton({
  item,
  current,
  onNavigate,
  sub = false,
}: {
  item: NavItem
  current: string
  onNavigate: (href: string) => void
  sub?: boolean
}) {
  const active = current === item.href || (item.href !== '/' && current.startsWith(item.href + '/'))
  const disabled = item.disabled === true

  return (
    <button
      type="button"
      onClick={() => !disabled && onNavigate(item.href)}
      title={item.label}
      disabled={disabled}
      className={`relative flex w-full items-center gap-2.5 rounded-xl text-left transition ${
        sub ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm'
      } ${
        active
          ? 'bg-[var(--panel-strong)] text-[var(--text)] shadow-[inset_0_0_0_1px_var(--border-soft)]'
          : disabled
            ? 'cursor-default text-[var(--muted)] opacity-40'
            : 'text-[var(--muted)] hover:bg-[var(--panel-subtle)] hover:text-[var(--text)]'
      }`}
    >
      <span className={`flex shrink-0 items-center justify-center rounded-lg border border-[var(--border-soft)] bg-[var(--panel-subtle)] ${sub ? 'h-5 w-5' : 'h-6 w-6'}`}>
        {item.icon}
      </span>
      <span className="truncate font-medium">{item.label}</span>
      {item.badge != null && item.badge > 0 && (
        <span className="ml-auto rounded-full border border-amber-400/20 bg-amber-400/12 px-1.5 py-0.5 text-[10px] text-amber-500">
          {item.badge}
        </span>
      )}
    </button>
  )
}
