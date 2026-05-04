import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Sidebar } from './components/Sidebar'
import { LiveFeed } from './pages/LiveFeed'
import { Approvals } from './pages/Approvals'
import { Runs } from './pages/Runs'
import { Agents } from './pages/Agents'
import { Providers } from './pages/Providers'
import { useApprovals } from './hooks/useApprovals'

const queryClient = new QueryClient()

const NAV = [
  { label: 'Live Feed', icon: '⚡', href: '/' },
  { label: 'Approvals', icon: '🔔', href: '/approvals' },
  { label: 'Runs', icon: '📋', href: '/runs' },
  { label: 'Agents', icon: '🤖', href: '/agents' },
  { label: 'Providers', icon: '🔌', href: '/providers' },
]

function Layout() {
  const [page, setPage] = useState('/')
  const { approvals } = useApprovals()

  const navItems = NAV.map((item) =>
    item.href === '/approvals'
      ? { ...item, badge: approvals.filter((a) => a.status === 'pending').length }
      : item
  )

  const Page = page === '/' ? LiveFeed
    : page === '/approvals' ? Approvals
    : page === '/runs' ? Runs
    : page === '/agents' ? Agents
    : Providers

  return (
    <div className="flex h-screen bg-gray-950 text-white">
      <Sidebar items={navItems} current={page} onNavigate={setPage} />
      <main className="flex-1 overflow-y-auto">
        <Page />
      </main>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Layout />
    </QueryClientProvider>
  )
}
