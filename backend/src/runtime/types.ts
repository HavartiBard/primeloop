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
  lease: RuntimeLease
}

// Launcher-managed runtime status types
export type LauncherRuntimeState = 'provisioning' | 'ready' | 'unhealthy' | 'reprovisioning' | 'tearing_down' | 'unavailable';
export type LauncherHealthStatus = 'healthy' | 'degraded' | 'failed' | 'unknown';

export interface MountSpec {
  path: string;
  mode: 'ro' | 'rw';
  purpose: string;
}

export interface NetworkPolicy {
  mode: 'default-deny';
  allowlist: string[];
}

export interface AcpEndpoint {
  protocol: 'http' | 'https' | 'ws' | 'wss';
  host: string;
  port: number;
  path: string;
  authHeader?: string;
  tlsCaCertPath?: string;
}

export interface LauncherRuntimeStatus {
  agentId: string;
  state: LauncherRuntimeState;
  healthStatus: LauncherHealthStatus;
  containerIdentity: string;
  acpEndpoint: AcpEndpoint;
  workdir: string;
  mounts: MountSpec[];
  networkPolicy: NetworkPolicy;
  lastTransitionReason?: string;
}
