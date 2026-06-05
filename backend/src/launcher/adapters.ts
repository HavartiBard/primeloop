import { exec } from 'child_process'
import { promisify } from 'util'
import axios, { AxiosInstance } from 'axios'
import type { MountSpec, NetworkPolicy, RuntimeStatus } from './runtime-manager.js'

const execPromise = promisify(exec)

type RuntimeFamily = 'opencode'
type HealthStatus = RuntimeStatus['healthStatus']

export interface AdapterProvisionInput {
  agentId: string
  runtimeFamily: RuntimeFamily
  workdir: string
  env: Record<string, string>
  mounts: MountSpec[]
  networkPolicy: NetworkPolicy
  runtimeImage?: string
}

export interface AdapterRuntimeState {
  containerIdentity: string
  sessionEndpoint: string
  healthStatus: HealthStatus
  mounts: MountSpec[]
  networkPolicy: NetworkPolicy
}

export interface AdapterHealthResult {
  reachable: boolean
  notes: string[]
}

export interface LauncherRuntimeAdapter {
  readonly kind: string
  provision(input: AdapterProvisionInput): Promise<AdapterRuntimeState>
  inspect(containerIdentity: string): Promise<Partial<AdapterRuntimeState> | null>
  restart(input: AdapterProvisionInput & { containerIdentity: string }): Promise<AdapterRuntimeState>
  teardown(containerIdentity: string): Promise<void>
  healthCheck(): Promise<AdapterHealthResult>
}

export class DockerLauncherAdapter implements LauncherRuntimeAdapter {
  readonly kind = 'docker'

  async provision(input: AdapterProvisionInput): Promise<AdapterRuntimeState> {
    const containerIdentity = `launcher-${input.agentId}`
    const mountFlags = input.mounts.map((m) => `-v "${m.path}:${m.path}"`).join(' ')
    const runtimeImage = input.runtimeImage ?? process.env.OPENSANDBOX_IMAGE_OPENCODE ?? 'opencode/opencode:latest'
    const envFlags = Object.entries({
      ...input.env,
      AGENT_ID: input.agentId,
      WORKDIR: input.workdir,
      RUNTIME_FAMILY: input.runtimeFamily,
    }).map(([k, v]) => `-e ${k}="${v}"`).join(' ')

    await execPromise(
      `docker run -d --name ${containerIdentity} ${mountFlags} ${envFlags} ${runtimeImage}`,
    )

    return {
      containerIdentity,
      sessionEndpoint: `http://${containerIdentity}:8080`,
      healthStatus: 'healthy',
      mounts: input.mounts,
      networkPolicy: input.networkPolicy,
    }
  }

  async inspect(containerIdentity: string): Promise<Partial<AdapterRuntimeState> | null> {
    try {
      await execPromise(`docker inspect ${containerIdentity} > /dev/null 2>&1`)
      return { containerIdentity, healthStatus: 'healthy' }
    } catch {
      return null
    }
  }

  async restart(input: AdapterProvisionInput & { containerIdentity: string }): Promise<AdapterRuntimeState> {
    await this.teardown(input.containerIdentity)
    return this.provision(input)
  }

  async teardown(containerIdentity: string): Promise<void> {
    await execPromise(`docker stop ${containerIdentity} > /dev/null 2>&1 || true`)
    await execPromise(`docker rm ${containerIdentity} > /dev/null 2>&1 || true`)
  }

  async healthCheck(): Promise<AdapterHealthResult> {
    try {
      await execPromise('docker info > /dev/null 2>&1')
      return { reachable: true, notes: [] }
    } catch {
      return { reachable: false, notes: ['Container runtime unreachable'] }
    }
  }
}

// Environment variable name for OpenCode runtime image (updated from PI/ACP specific vars)
const OPENSANDBOX_IMAGE_OPENCODE = process.env.OPENSANDBOX_IMAGE_OPENCODE ?? 'opencode/opencode:latest'

export class OpenSandboxLauncherAdapter implements LauncherRuntimeAdapter {
  readonly kind = 'opensandbox'
  private client: AxiosInstance

  constructor(
    private readonly baseUrl = process.env.OPENSANDBOX_URL ?? 'http://opensandbox:8080',
    private readonly apiKey = process.env.OPENSANDBOX_API_KEY ?? '',
  ) {
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        'Content-Type': 'application/json',
      },
    })
  }

  async provision(input: AdapterProvisionInput): Promise<AdapterRuntimeState> {
    const image = this.imageForFamily(input.runtimeFamily, input)
    const response = await this.client.post('/sandboxes', {
      image,
      env: {
        ...input.env,
        AGENT_ID: input.agentId,
        WORKDIR: input.workdir,
        RUNTIME_FAMILY: input.runtimeFamily,
      },
      labels: {
        agentId: input.agentId,
        runtimeFamily: input.runtimeFamily,
        launcher: 'primeloop',
      },
      mounts: input.mounts.map((mount) => ({
        source: mount.path,
        target: mount.path,
        readOnly: mount.mode === 'ro',
      })),
      networkPolicy: input.networkPolicy,
    })

    const data = response.data as Record<string, any>
    const sandboxId = this.pickString(data, ['id', 'sandboxId'])
    const sessionEndpoint = this.pickString(data, ['sessionEndpoint', 'endpoint', 'url'])
      ?? `${this.baseUrl.replace(/\/$/, '')}/sandboxes/${sandboxId}`

    if (!sandboxId) {
      throw new Error('OpenSandbox provision response missing sandbox id')
    }

    return {
      containerIdentity: sandboxId,
      sessionEndpoint,
      healthStatus: 'healthy',
      mounts: input.mounts,
      networkPolicy: input.networkPolicy,
    }
  }

  async inspect(containerIdentity: string): Promise<Partial<AdapterRuntimeState> | null> {
    try {
      const response = await this.client.get(`/sandboxes/${containerIdentity}`)
      const data = response.data as Record<string, any>
      const status = String(data.status ?? data.state ?? '').toLowerCase()
      const healthStatus: HealthStatus = status.includes('running') || status.includes('ready')
        ? 'healthy'
        : status.includes('degraded')
          ? 'degraded'
          : status.includes('failed') || status.includes('error')
            ? 'failed'
            : 'unknown'

      return {
        containerIdentity,
        sessionEndpoint: this.pickString(data, ['sessionEndpoint', 'endpoint', 'url']),
        healthStatus,
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null
      }
      throw error
    }
  }

  async restart(input: AdapterProvisionInput & { containerIdentity: string }): Promise<AdapterRuntimeState> {
    try {
      const response = await this.client.post(`/sandboxes/${input.containerIdentity}/restart`)
      const data = response.data as Record<string, any>
      return {
        containerIdentity: this.pickString(data, ['id', 'sandboxId']) ?? input.containerIdentity,
        sessionEndpoint: this.pickString(data, ['sessionEndpoint', 'endpoint', 'url']) ?? `${this.baseUrl.replace(/\/$/, '')}/sandboxes/${input.containerIdentity}`,
        healthStatus: 'healthy',
        mounts: input.mounts,
        networkPolicy: input.networkPolicy,
      }
    } catch {
      await this.teardown(input.containerIdentity)
      return this.provision(input)
    }
  }

  async teardown(containerIdentity: string): Promise<void> {
    await this.client.delete(`/sandboxes/${containerIdentity}`)
  }

  async healthCheck(): Promise<AdapterHealthResult> {
    try {
      await this.client.get('/health')
      return { reachable: true, notes: [] }
    } catch {
      return { reachable: false, notes: ['OpenSandbox API unreachable'] }
    }
  }

  private imageForFamily(runtimeFamily: RuntimeFamily, input: AdapterProvisionInput): string {
    return input.runtimeImage ?? process.env.OPENSANDBOX_IMAGE_OPENCODE ?? 'opencode/opencode:latest'
  }

  private pickString(data: Record<string, any>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = data[key]
      if (typeof value === 'string' && value.length > 0) return value
    }
    return undefined
  }
}

export function createLauncherRuntimeAdapter(): LauncherRuntimeAdapter {
  const kind = (process.env.LAUNCHER_ADAPTER ?? 'docker').toLowerCase()
  if (kind === 'opensandbox') {
    return new OpenSandboxLauncherAdapter()
  }
  return new DockerLauncherAdapter()
}
