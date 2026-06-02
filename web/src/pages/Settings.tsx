import { useState } from 'react'
import { Providers } from './Providers'
import { Agents } from './Agents'
import { McpServers } from './McpServers'
import { RoutingTab } from './settings/RoutingTab'
import { PersonalityTab } from './settings/PersonalityTab'

export type SettingsTabId = 'providers' | 'routing' | 'agents' | 'integrations' | 'personality'

interface SettingsProps {
  defaultTab?: SettingsTabId
}

const TABS: Array<{ id: SettingsTabId; label: string }> = [
  { id: 'providers',    label: 'Providers' },
  { id: 'routing',      label: 'Routing' },
  { id: 'agents',       label: 'Agents' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'personality',  label: 'Personality' },
]

export function Settings({ defaultTab = 'providers' }: SettingsProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(defaultTab)

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 border-b border-[var(--border-soft)] bg-[var(--topbar-bg)] px-4 py-2.5 backdrop-blur">
        <div className="flex gap-1.5 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 rounded border px-3 py-1.5 text-xs font-medium transition ${
                activeTab === tab.id
                  ? 'border-[#6ee7ff] bg-[#1f6feb] text-white'
                  : 'border-[var(--border-soft)] bg-[var(--panel-subtle)] text-[var(--muted)] hover:bg-[var(--panel)] hover:text-[var(--text)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        {activeTab === 'providers'    && <Providers />}
        {activeTab === 'routing'      && <RoutingTab />}
        {activeTab === 'agents'       && <Agents />}
        {activeTab === 'integrations' && <McpServers />}
        {activeTab === 'personality'  && <PersonalityTab />}
      </div>
    </div>
  )
}
