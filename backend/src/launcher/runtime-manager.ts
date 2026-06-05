import {
  type AdapterHealthResult,
  type AdapterProvisionInput,
  type LauncherRuntimeAdapter,
  createLauncherRuntimeAdapter,
} from './adapters.js'

export interface ProvisionRequest {
  agentId: string
  runtimeFamily: 'opencode'
  workdir: string
  env: Record<string, string>
  expectedMounts?: MountSpec[]
  networkPolicy?: NetworkPolicy
  runtimeImage?: string
}

export interface ProvisionResponse {
  agentId: string
  acpEndpoint: { protocol: 'http' | 'https' | 'ws' | 'wss'; host: string; port: number; path: string }
  runtimeStatus: RuntimeStatus
  containerIdentity: string
}

export interface ProvisionRuntimeResult extends ProvisionResponse {
  created: boolean
}

export interface RuntimeStatus {
  agentId: string
  state: 'provisioning' | 'ready' | 'unhealthy' | 'reprovisioning' | 'tearing_down' | 'unavailable'
  healthStatus: 'healthy' | 'degraded' | 'failed' | 'unknown'
  containerIdentity: string
  acpEndpoint: { protocol: 'http' | 'https' | 'ws' | 'wss'; host: string; port: number; path: string }
  workdir: string
  mounts: MountSpec[]
  networkPolicy: NetworkPolicy
  lastTransitionReason?: string
}

interface RuntimeSlot {
  status: RuntimeStatus
  runtimeFamily: 'opencode'
  runtimeImage: string
  env: Record<string, string>
}

export interface MountSpec {
  path: string
  mode: 'ro' | 'rw'
  purpose: string
}

export interface NetworkPolicy {
  mode: 'default-deny'
  allowlist: string[]
}

function parseSessionEndpoint(endpoint: string): { protocol: 'http' | 'https' | 'ws' | 'wss'; host: string; port: number; path: string } {
  try {
    const url = new URL(endpoint)
    const protocol = url.protocol === 'https:' ? 'https' : url.protocol === 'wss:' ? 'wss' : url.protocol === 'ws:' ? 'ws' : 'http'
    return {
      protocol,
      host: url.hostname,
      port: url.port ? parseInt(url.port, 10) : (protocol.startsWith('https') || protocol.startsWith('wss') ? 443 : 80),
      path: url.pathname === '/' ? '/acp' : url.pathname,
    }
  } catch {
    // Fallback for simple host:port format
    const [host, portPart] = endpoint.replace(/^https?:\/\//, '').split(':')
    return {
      protocol: 'http',
      host: host || 'localhost',
      port: portPart ? parseInt(portPart, 10) : 8080,
      path: '/acp',
    }
  }
}

export class RuntimeManager {
  private slots: Map<string, RuntimeSlot> = new Map()

  constructor(private readonly adapter: LauncherRuntimeAdapter = createLauncherRuntimeAdapter()) {}

  public async provisionRuntime(request: ProvisionRequest): Promise<ProvisionRuntimeResult> {
    const { agentId, runtimeFamily, workdir, env } = request

    const existing = this.slots.get(agentId)
    if (existing && existing.status.state !== 'tearing_down' && existing.status.state !== 'unavailable') {
      return {
        created: false,
        agentId,
        acpEndpoint: existing.status.acpEndpoint,
        runtimeStatus: existing.status,
        containerIdentity: existing.status.containerIdentity,
      }
    }

    const mounts: MountSpec[] = request.expectedMounts && request.expectedMounts.length > 0
      ? request.expectedMounts
      : [
          { path: workdir, mode: 'rw', purpose: 'worktree' },
          { path: '/tmp/launcher-scratch', mode: 'rw', purpose: 'scratch' },
        ]

    const runtimeImage = request.runtimeImage ?? process.env.OPENSANDBOX_IMAGE_OPENCODE ?? 'opencode/opencode:latest'

    const runtimeEnv = {
      ...env,
      AGENT_ID: agentId,
      WORKDIR: workdir,
      RUNTIME_FAMILY: runtimeFamily,
    }

    const adapterInput: AdapterProvisionInput = {
      agentId,
      runtimeFamily,
      workdir,
      env: runtimeEnv,
      mounts,
      networkPolicy: request.networkPolicy ?? { mode: 'default-deny', allowlist: [] },
      runtimeImage,
    }

    const provisioned = await this.adapter.provision(adapterInput)

    const acpEndpoint = parseSessionEndpoint(provisioned.sessionEndpoint)

    const status: RuntimeStatus = {
      agentId,
      state: 'ready',
      healthStatus: provisioned.healthStatus,
      containerIdentity: provisioned.containerIdentity,
      acpEndpoint,
      workdir,
      mounts: provisioned.mounts,
      networkPolicy: provisioned.networkPolicy,
    }

    this.slots.set(agentId, { status, runtimeFamily, runtimeImage, env: { ...env } })

    return {
      created: true,
      agentId,
      acpEndpoint,
      runtimeStatus: status,
      containerIdentity: status.containerIdentity,
    }
  }

  public async inspectRuntime(agentId: string): Promise<RuntimeStatus> {
    const slot = this.slots.get(agentId)
    if (!slot) {
      throw new Error('Not found')
    }

    const inspected = await this.adapter.inspect(slot.status.containerIdentity)
    if (!inspected) {
      throw new Error('Not found')
    }

    const acpEndpoint = parseSessionEndpoint(inspected.sessionEndpoint ?? slot.status.acpEndpoint.host + ':' + slot.status.acpEndpoint.port)

    const status: RuntimeStatus = {
      ...slot.status,
      acpEndpoint,
      healthStatus: inspected.healthStatus ?? slot.status.healthStatus,
    }

    this.slots.set(agentId, { ...slot, status })
    return status
  }

  public async restartRuntime(agentId: string): Promise<RuntimeStatus> {
    const existing = this.slots.get(agentId)
    if (!existing) {
      throw new Error('Not found')
    }

    const reprovisioningStatus: RuntimeStatus = {
      ...existing.status,
      state: 'reprovisioning',
      lastTransitionReason: 'Restart requested',
    }

    this.slots.set(agentId, { ...existing, status: reprovisioningStatus })

    const restarted = await this.adapter.restart({
      agentId,
      runtimeFamily: existing.runtimeFamily,
      workdir: existing.status.workdir,
      env: {
        ...existing.env,
        AGENT_ID: agentId,
        WORKDIR: existing.status.workdir,
        RUNTIME_FAMILY: existing.runtimeFamily,
      },
      mounts: existing.status.mounts,
      networkPolicy: existing.status.networkPolicy,
      containerIdentity: existing.status.containerIdentity,
      runtimeImage: existing.runtimeImage,
    })

    const acpEndpoint = parseSessionEndpoint(restarted.sessionEndpoint)

    const status: RuntimeStatus = {
      ...existing.status,
      containerIdentity: restarted.containerIdentity,
      acpEndpoint,
      healthStatus: restarted.healthStatus,
      mounts: restarted.mounts,
      networkPolicy: restarted.networkPolicy,
      state: 'ready',
      lastTransitionReason: 'Restart completed',
    }

    this.slots.set(agentId, { ...existing, status })
    return status
  }

  public async teardownRuntime(agentId: string): Promise<void> {
    const existing = this.slots.get(agentId)
    if (!existing) {
      throw new Error('Not found')
    }

    const status: RuntimeStatus = {
      ...existing.status,
      state: 'tearing_down',
      lastTransitionReason: 'Teardown requested',
    }

    this.slots.set(agentId, { ...existing, status })
    await this.adapter.teardown(existing.status.containerIdentity)
    this.slots.delete(agentId)
  }

  public async healthCheck(): Promise<AdapterHealthResult> {
    return this.adapter.healthCheck()
  }

  public async getAllSlots(): Promise<Map<string, RuntimeStatus>> {
    return new Map(Array.from(this.slots.entries(), ([agentId, slot]) => [agentId, slot.status]))
  }

  public async getSlot(agentId: string): Promise<RuntimeStatus | undefined> {
    return this.slots.get(agentId)?.status
  }

  public async clearAllSlots(): Promise<void> {
    this.slots.clear()
  }
}
