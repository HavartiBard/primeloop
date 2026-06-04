// Runtime types for lease management (FR-012, FR-013, FR-014)

export interface RuntimeLease {
  id: string
  agent_id: string
  status: 'provisioning' | 'active' | 'idle' | 'reclaimed'
  sandbox_id?: string
  acquired_at: string
  last_activity_at: string
  released_at?: string
}

export interface LeaseResult {
  leaseId: string
  harness: any  // AgentHarness placeholder
}
