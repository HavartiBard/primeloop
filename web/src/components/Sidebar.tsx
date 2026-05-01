interface NavItem { label: string; icon: string; href: string; badge?: number }

interface Props {
  items: NavItem[]
  current: string
  onNavigate: (href: string) => void
}

export function Sidebar({ items, current, onNavigate }: Props) {
  return (
    <div className="w-40 bg-gray-950 border-r border-gray-800 flex flex-col p-3 gap-1">
      <div className="text-blue-400 font-bold text-xs tracking-widest mb-3 px-2">AGENT CP</div>
      {items.map((item) => (
        <button
          key={item.href}
          onClick={() => onNavigate(item.href)}
          className={`flex items-center gap-2 px-2 py-2 rounded text-xs text-left w-full
            ${current === item.href ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-200'}`}
        >
          <span>{item.icon}</span>
          <span>{item.label}</span>
          {item.badge != null && item.badge > 0 && (
            <span className="ml-auto bg-red-600 text-white text-xs rounded-full px-1.5">{item.badge}</span>
          )}
        </button>
      ))}
      <div className="mt-auto pt-3 border-t border-gray-800 px-2">
        <span className="text-gray-600 text-xs">2 agents</span>
      </div>
    </div>
  )
}
