import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type pg from 'pg'
import { getOrCreateAgentToken } from '../agent-tokens.js'
import { decryptEnvVars } from '../mcp-registry.js'
import { listControlPlaneToolsForGrant, type McpToolDefinition } from '../mcp/service.js'
import { loadWorkspaceTemplate, renderTemplate } from '../workspace.js'
import {
  getProviderApiKey,
  type AgentState,
  type Provider,
  type RegistryAgent,
  updateAgent,
} from '../registry.js'
import { resolveToolGrant } from '../tool-grants.js'
import { isOpenAiCompatibleProviderType } from '../local-llm.js'
import { bootstrapDurableStaff } from '../durable-staff.js'

import { AcpHarness } from '../fleet-executor/acp-harness.js'
import type { AgentHarness } from '../fleet-executor/harness.js'
import { recoverInflight } from '../recovery/restart.js'
import { CredentialBroker } from '../credentials/broker.js'
import { provisionAgentCredentials, revokeAgentCredentials } from '../credentials/lifecycle.js'
import { RuntimeLeaseManager } from '../runtime/lease.js'

const execFileAsync = promisify(execFile)
const DEFAULT_PORT_START = 4200
const DEFAULT_REPO_ROOT = '/workspace/repo'
const DEFAULT_AGENTS_ROOT = '/workspace/agents'
const DEFAULT_CONTROL_PLANE_URL = 'http://localhost:3100'
const START_RETRIES = 3
const HEALTH_TIMEOUT_MS = 10_000
const HEALTH_INTERVAL_MS = 500
const RECOVERY_ERROR = 'interrupted during harness restart recovery'

type ChildProcessLike = {
  kill(signal?: NodeJS.Signals | number): boolean
  on(event: 'close', listener: (code: number | null) => void): void
  stdout?: NodeJS.ReadableStream | null
  stderr?: NodeJS.ReadableStream | null
}

type SpawnFn = typeof spawn
type FetchFn = typeof globalThis.fetch
type JsonRecord = Record<string, unknown>

interface ProcessState {
  child: ChildProcessLike
  restartAttempts: number
  stopped: boolean
}

interface ProcessManagerDeps {
  repoRoot?: string
  agentsRoot?: string
  controlPlaneUrl?: string
  spawnFn?: SpawnFn
  fetchFn?: FetchFn
  execFileFn?: typeof execFileAsync
  sleepFn?: (ms: number) => Promise<void>
}

interface MCPServerRecord {
  id: string
  name: string
  description?: string | null
  type: 'http' | 'stdio'
  url?: string | null
  command?: string | null
  args?: string[] | null
  env_vars?: JsonRecord | null
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent'
}

function isManagedLocalAgent(agent: RegistryAgent): boolean {
  return agent.enabled
    && agent.execution_mode === 'local'
    && (
      agent.runtime_family === 'opencode'
      || agent.runtime_family === 'codex-app-server'
      || agent.runtime_family === 'pi'
      || agent.runtime_family === 'acp'
    )
}

async function defaultAgentInstructions(pool: pg.Pool, agent: RegistryAgent): Promise<string> {
  if (agent.system_prompt?.trim()) return agent.system_prompt.trim()
  const template = await loadWorkspaceTemplate(pool, 'prompts/agents/default-instructions.md', 'agents/default-instructions.md')
  return renderTemplate(template, {
    agent_name: agent.name,
  })
}

async function defaultSoul(pool: pg.Pool, agent: RegistryAgent): Promise<string> {
  if (agent.soul?.trim()) return agent.soul.trim()
  const template = await loadWorkspaceTemplate(pool, 'prompts/agents/default-soul.md', 'agents/default-soul.md')
  return renderTemplate(template, {
    agent_name: agent.name,
  })
}

function formatSchemaValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ')
  return String(value)
}

function renderSchemaProperties(schema: Record<string, unknown>): string[] {
  const properties = typeof schema['properties'] === 'object' && schema['properties'] && !Array.isArray(schema['properties'])
    ? schema['properties'] as Record<string, Record<string, unknown>>
    : {}
  const required = Array.isArray(schema['required']) ? new Set(schema['required'].map((item) => String(item))) : new Set<string>()

  return Object.entries(properties).map(([name, prop]) => {
    const type = typeof prop['type'] === 'string' ? prop['type'] : 'unknown'
    const requiredLabel = required.has(name) ? 'required' : 'optional'
    const description = typeof prop['description'] === 'string' ? prop['description'] : ''
    const enumValues = Array.isArray(prop['enum']) ? ` [${prop['enum'].map((item) => formatSchemaValue(item)).join(' | ')}]` : ''
    return `- \`${name}\` (${type}, ${requiredLabel})${enumValues}${description ? `: ${description}` : ''}`
  })
}

function renderControlPlaneToolsMarkdown(tools: McpToolDefinition[]): string {
  const sections = ['# Tools Available', '', '## Control Plane', '', 'Machine-readable metadata: `control-plane-tools.json`']
  for (const tool of tools) {
    sections.push('', `### ${tool.name}`, `${tool.description}`)
    if (tool.prime_only) {
      sections.push('Prime only: yes')
    }
    const inputLines = renderSchemaProperties(tool.inputSchema)
    if (inputLines.length > 0) {
      sections.push('', 'Inputs:')
      sections.push(...inputLines)
    }
    const outputLines = renderSchemaProperties(tool.outputSchema)
    if (outputLines.length > 0) {
      sections.push('', 'Outputs:')
      sections.push(...outputLines)
    }
  }
  return `${sections.join('\n')}\n`
}

function normalizeEnvVars(value: JsonRecord | null | undefined): Record<string, string> {
  return decryptEnvVars(value)
}

function providerEnvName(provider: Provider | null): string | null {
  if (!provider) return null
  if (provider.type === 'anthropic') return 'ANTHROPIC_API_KEY'
  if (provider.type === 'llm' && typeof provider.model === 'string' && provider.model.startsWith('anthropic/')) {
    return 'ANTHROPIC_API_KEY'
  }
  if (isOpenAiCompatibleProviderType(provider.type)) return 'OPENAI_API_KEY'
  return null
}

export class OpenCodeProcessManager {
  private readonly repoRoot: string
  private readonly agentsRoot: string
  private readonly controlPlaneUrl: string
  private readonly spawnFn: SpawnFn
  private readonly fetchFn: FetchFn
  private readonly execFileFn: typeof execFileAsync
  private readonly sleepFn: (ms: number) => Promise<void>
  private readonly processes = new Map<string, ProcessState>()
  private readonly harnesses = new Map<string, AgentHarness>()
  private readonly startingAgents = new Map<string, Promise<void>>()
  private readonly broker: CredentialBroker
  private readonly leaseManager: RuntimeLeaseManager

  private get credentialBrokerEnabled(): boolean {
    return process.env.CREDENTIAL_BROKER === '1'
  }

  private get egressSandboxEnabled(): boolean {
    return process.env.EGRESS_SANDBOX === '1'
  }

  private get launcherUrl(): string {
    return process.env.LAUNCHER_URL ?? 'http://launcher:8787'
  }

  private get launcherEnabled(): boolean {
    // Launcher is enabled by default when EGRESS_SANDBOX is enabled (the new default)
    // or explicitly via LAUNCHER_ENABLED=1
    return process.env.LAUNCHER_ENABLED === '1' || this.egressSandboxEnabled
  }

  private get launcherDefaultEnabled(): boolean {
    // Launcher is the DEFAULT path for managed local OpenCode agents when EGRESS_SANDBOX is enabled
    // This makes launcher-managed isolated runtimes the default deployment path
    return this.launcherEnabled
  }

  constructor(
    private readonly pool: pg.Pool,
    deps: ProcessManagerDeps = {},
  ) {
    this.broker = new CredentialBroker(this.pool)
    this.leaseManager = new RuntimeLeaseManager(this.pool)
    this.repoRoot = deps.repoRoot ?? process.env.AGENT_REPO_ROOT ?? DEFAULT_REPO_ROOT
    this.agentsRoot = deps.agentsRoot ?? process.env.AGENT_WORKTREE_ROOT ?? DEFAULT_AGENTS_ROOT
    this.controlPlaneUrl = deps.controlPlaneUrl ?? process.env.CONTROL_PLANE_URL ?? DEFAULT_CONTROL_PLANE_URL
    this.spawnFn = deps.spawnFn ?? spawn
    this.fetchFn = deps.fetchFn ?? fetch
    this.execFileFn = deps.execFileFn ?? execFileAsync
    this.sleepFn = deps.sleepFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  async initialize(): Promise<void> {
    await this.recoverLifecycleState()

    // Bootstrap durable staff before syncing agents
    const bootstrapResult = await bootstrapDurableStaff(this.pool)
    if (bootstrapResult.created.length > 0 || bootstrapResult.updated.length > 0) {
      console.log(
        `[durable-staff] Bootstrapped: ${bootstrapResult.created.length} created, ${bootstrapResult.updated.length} updated, ${bootstrapResult.unchanged.length} unchanged`,
      )
    }

    const { rows } = await this.pool.query<RegistryAgent>(
      `SELECT *
       FROM agents
       WHERE COALESCE(tier, 'durable') <> 'ephemeral'
       ORDER BY created_at`
    )
    for (const agent of rows) {
      await this.syncAgent(agent).catch((err: unknown) => {
        console.error(`[process-manager] failed to sync agent ${agent.name} (${agent.id}):`, err)
      })
    }
  }

  async syncAgent(agent: RegistryAgent): Promise<RegistryAgent> {
    if (!isManagedLocalAgent(agent)) {
      this.stopAgent(agent.id)
      return agent
    }

    await this.setAgentState(agent.id, 'provisioning', 'preparing managed local runtime')

    try {
      const preparedAgent = await this.prepareAgent(agent)
      await this.ensureWorktree(preparedAgent)
      await this.writeConfigFiles(preparedAgent)

      const shouldStartImmediately = preparedAgent.tier === 'ephemeral'
      const existing = this.processes.get(preparedAgent.id)
      if (shouldStartImmediately && !existing) {
        await this.startAgent(preparedAgent)
      }

      const readyState = preparedAgent.tier === 'ephemeral' ? 'ready' : 'idle'
      const readyReason = shouldStartImmediately
        ? 'managed local runtime ready'
        : 'managed local runtime prepared for lazy provisioning'
      await this.setAgentState(preparedAgent.id, readyState, readyReason)
      return await this.refreshAgent(preparedAgent.id) ?? preparedAgent
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.setAgentState(agent.id, 'error', `provisioning failed: ${message}`)
      throw error
    }
  }

  getRunningHarness(agentId: string): AgentHarness | undefined {
    return this.harnesses.get(agentId)
  }

  async ensureAgentStarted(agentId: string): Promise<void> {
    const existingStart = this.startingAgents.get(agentId)
    if (existingStart) {
      await existingStart
      return
    }

    const startPromise = (async () => {
      const agent = await this.refreshAgent(agentId)
      if (!agent || !isManagedLocalAgent(agent)) return

      if (agent.tier === 'durable') {
        await this.leaseManager.acquire(agentId)
      }

      const preparedAgent = await this.prepareAgent(agent)
      await this.ensureWorktree(preparedAgent)
      await this.writeConfigFiles(preparedAgent)

      const hasProcess = this.processes.has(preparedAgent.id)
      const hasHarness = this.harnesses.has(preparedAgent.id)
      if (!hasProcess && !hasHarness) {
        await this.startAgent(preparedAgent)
        await this.setAgentState(preparedAgent.id, 'idle', 'managed local runtime started on demand')
      }
    })()

    this.startingAgents.set(agentId, startPromise)
    try {
      await startPromise
    } finally {
      this.startingAgents.delete(agentId)
    }
  }

  async ensureHarness(agentId: string): Promise<AgentHarness | undefined> {
    const existingHarness = this.harnesses.get(agentId)
    if (existingHarness) return existingHarness

    const agent = await this.refreshAgent(agentId)
    if (!agent || !isManagedLocalAgent(agent)) return undefined
    // OpenCode agents use local process management, not harnesses
    if (agent.runtime_family !== 'acp' && agent.runtime_family !== 'pi' && agent.runtime_family !== 'opencode') return undefined

    await this.ensureAgentStarted(agentId)
    return this.harnesses.get(agentId)
  }

  stopAgent(agentId: string): void {
    // Synchronously revoke brokered credentials at teardown (FR-007). Fire-and-forget
    // since stopAgent is sync; no-op when the flag is off.
    void revokeAgentCredentials(this.broker, agentId, this.credentialBrokerEnabled)
    const harness = this.harnesses.get(agentId)
    if (harness) {
      console.log(`[process-manager] Reaping AcpHarness for agent ${agentId}`)
      void harness.close()
      this.harnesses.delete(agentId)
    }
    const running = this.processes.get(agentId)
    if (!running) return
    running.stopped = true
    running.child.kill()
    this.processes.delete(agentId)
  }

  private async prepareAgent(agent: RegistryAgent): Promise<RegistryAgent> {
    const updates: Partial<Omit<RegistryAgent, 'id' | 'created_at'>> = {}
    const localPort = agent.local_port ?? await this.nextPort()
    const worktreePath = agent.worktree_path ?? path.join(this.agentsRoot, slugify(agent.name))
    const endpoint = `http://127.0.0.1:${localPort}`

    if (agent.local_port !== localPort) updates.local_port = localPort
    if (agent.worktree_path !== worktreePath) updates.worktree_path = worktreePath
    if (agent.endpoint !== endpoint) updates.endpoint = endpoint

    if (Object.keys(updates).length === 0) {
      return { ...agent, local_port: localPort, worktree_path: worktreePath, endpoint }
    }

    const updated = await updateAgent(this.pool, agent.id, updates)
    return updated
  }

  private async nextPort(): Promise<number> {
    const { rows } = await this.pool.query<{ next_port: number }>(
      `SELECT COALESCE(MAX(local_port), $1) + 1 AS next_port
       FROM agents
       WHERE local_port IS NOT NULL`,
      [DEFAULT_PORT_START - 1],
    )
    return Number(rows[0]?.next_port ?? DEFAULT_PORT_START)
  }

  private async ensureWorktree(agent: RegistryAgent): Promise<void> {
    const worktreePath = agent.worktree_path
    if (!worktreePath) throw new Error(`worktree_path missing for agent ${agent.name}`)

    await mkdir(this.agentsRoot, { recursive: true })

    try {
      await access(worktreePath)
      return
    } catch {
      await this.execFileFn('git', [
        '-C',
        this.repoRoot,
        'worktree',
        'add',
        worktreePath,
        '-b',
        `agent/${slugify(agent.name)}`,
      ])
    }
  }

  private async writeConfigFiles(agent: RegistryAgent): Promise<void> {
    const worktreePath = agent.worktree_path
    if (!worktreePath) throw new Error(`worktree_path missing for agent ${agent.name}`)
    const assignedServers = await this.listAssignedMcpServers(agent.id)
    const controlPlaneToken = this.credentialBrokerEnabled ? null : await getOrCreateAgentToken(this.pool, agent.id)
    const model = await this.resolveModel(agent)
    const fallbackProviderAdapters = assignedServers.map((server) => ({
      kind: server.type,
      ref: server.name,
      config: server.type === 'http'
        ? { url: server.url ?? null }
        : { command: server.command ?? null, args: server.args ?? [] },
    }))

    // Slice 3: persist a baseline tool grant for this agent
    const grant = await resolveToolGrant(this.pool, {
      agent,
      routingCapability: agent.role ?? agent.capabilities[0] ?? agent.type,
      fallbackProviderAdapters,
      taskScope: {},
      approvalState: {},
      environmentContext: {
        assigned_mcp_servers: assignedServers.map((server) => server.name),
      },
    })

    // Slice 4: filter control-plane tools based on resolved grant (CP-001, CP-004)
    const controlPlaneTools = listControlPlaneToolsForGrant(
      grant.granted_primitives ?? [],
      false,
    )

    await mkdir(worktreePath, { recursive: true })
    await writeFile(path.join(worktreePath, 'AGENTS.md'), `${(await defaultAgentInstructions(this.pool, agent)).trim()}\n`)
    await writeFile(path.join(worktreePath, 'soul.md'), `${(await defaultSoul(this.pool, agent)).trim()}\n`)
    await writeFile(path.join(worktreePath, 'TOOLS.md'), this.renderToolsMarkdown(controlPlaneTools, assignedServers))
    await writeFile(path.join(worktreePath, 'control-plane-tools.json'), `${JSON.stringify(controlPlaneTools, null, 2)}\n`)
    await writeFile(path.join(worktreePath, 'opencode.json'), JSON.stringify({
      model,
      mcpServers: {
        'control-plane': {
          type: 'stdio',
          command: 'node',
          args: ['/app/backend/dist/mcp/server.js'],
          env: {
            CONTROL_PLANE_URL: this.controlPlaneUrl,
            ...(controlPlaneToken ? { CONTROL_PLANE_AGENT_TOKEN: controlPlaneToken } : {}),
          },
        },
        soullayer: {
          type: 'stdio',
          command: 'soullayer-pg',
          env: {
            POSTGRES_URL: process.env.DATABASE_URL ?? '',
            SOULLAYER_AGENT_ID: agent.id,
          },
        },
        ...Object.fromEntries(assignedServers.map((server) => [
          server.name,
          server.type === 'http'
            ? {
                type: 'http',
                url: server.url,
                ...(this.credentialBrokerEnabled ? {} : { env: normalizeEnvVars(server.env_vars) }),
              }
            : {
                type: 'stdio',
                command: server.command,
                args: server.args ?? [],
                ...(this.credentialBrokerEnabled ? {} : { env: normalizeEnvVars(server.env_vars) }),
              },
        ])),
      },
    }, null, 2))
    await writeFile(path.join(worktreePath, 'soullayer.json'), JSON.stringify({
      soulFile: 'soul.md',
      transport: 'stdio',
      postgres: {
        agentId: agent.id,
      },
    }, null, 2))
  }

  private async listAssignedMcpServers(agentId: string): Promise<MCPServerRecord[]> {
    const { rows } = await this.pool.query<MCPServerRecord>(
      `SELECT ms.*
       FROM mcp_servers ms
       JOIN agent_mcp_assignments ama ON ama.mcp_server_id = ms.id
       WHERE ama.agent_id = $1
       ORDER BY ms.name`,
      [agentId],
    )
    return rows
  }

  private async buildCredentialScope(agent: RegistryAgent, provider: Provider | null): Promise<{ namedSecrets: Array<{ envName: string; value: string }>; controlPlaneTokenEnvName: string; providerIds: string[]; providerTypes: string[] }> {
    const assignedServers = await this.listAssignedMcpServers(agent.id)
    const namedSecrets = assignedServers.flatMap((server) =>
      Object.entries(normalizeEnvVars(server.env_vars)).map(([envName, value]) => ({ envName, value }))
    )

    return {
      namedSecrets,
      controlPlaneTokenEnvName: 'CONTROL_PLANE_AGENT_TOKEN',
      providerIds: provider ? [provider.id] : [],
      providerTypes: provider ? [provider.type] : [],
    }
  }

  private renderToolsMarkdown(controlPlaneTools: McpToolDefinition[], assignedServers: MCPServerRecord[]): string {
    const sections = [renderControlPlaneToolsMarkdown(controlPlaneTools).trimEnd()]
    for (const server of assignedServers) {
      sections.push(`## ${server.name}
- type: ${server.type}${server.description ? `
- ${server.description}` : ''}`)
    }
    return `${sections.join('\n\n')}\n`
  }

  private async resolveProvider(agent: RegistryAgent): Promise<Provider | null> {
    if (!agent.provider_id) return null
    const { rows } = await this.pool.query<Provider>('SELECT * FROM providers WHERE id = $1', [agent.provider_id])
    return rows[0] ?? null
  }

  private async resolveModel(agent: RegistryAgent): Promise<string> {
    const provider = await this.resolveProvider(agent)
    if (provider?.model) return provider.model
    return 'openai/gpt-5'
  }

  private async startAgent(agent: RegistryAgent): Promise<void> {
    if (agent.runtime_family === 'pi' || agent.runtime_family === 'acp') {
      return this.startAcpAgent(agent)
    }

    const localPort = agent.local_port
    const worktreePath = agent.worktree_path
    if (!localPort || !worktreePath) {
      throw new Error(`local agent ${agent.name} is missing local_port or worktree_path`)
    }

    const provider = await this.resolveProvider(agent)
    const providerKey = provider ? await getProviderApiKey(this.pool, provider.id) : null
    const providerEnv = providerEnvName(provider)

    // Behind CREDENTIAL_BROKER: issue brokered, env-only credentials for this agent and
    // inject them alongside the existing config (FR-007/009). No-op when the flag is off.
    const brokerEnv = await provisionAgentCredentials(
      this.broker,
      agent.id,
      await this.buildCredentialScope(agent, provider),
      this.credentialBrokerEnabled,
    )
    const controlPlaneToken = this.credentialBrokerEnabled
      ? brokerEnv.CONTROL_PLANE_AGENT_TOKEN
      : await getOrCreateAgentToken(this.pool, agent.id)

    const env = {
      ...process.env,
      ...(providerEnv && providerKey ? { [providerEnv]: providerKey } : {}),
      ...(provider?.base_url && isOpenAiCompatibleProviderType(provider.type) ? { OPENAI_BASE_URL: provider.base_url } : {}),
      CONTROL_PLANE_URL: this.controlPlaneUrl,
      ...(controlPlaneToken ? { CONTROL_PLANE_AGENT_TOKEN: controlPlaneToken } : {}),
      POSTGRES_URL: process.env.DATABASE_URL ?? '',
      SOULLAYER_AGENT_ID: agent.id,
      ...brokerEnv,
    }

    await this.launchManagedProcess(agent, localPort, worktreePath, env, 0)
  }

  private async startAcpAgent(agent: RegistryAgent): Promise<void> {
    const worktreePath = agent.worktree_path
    if (!worktreePath) throw new Error(`worktree_path missing for acp agent ${agent.name}`)
    const workspaceRoot = agent.workspace_root ?? worktreePath

    const provider = await this.resolveProvider(agent)
    const model = await this.resolveModel(agent)

    // Pi runtime-family agents always use the built-in pi-acp launch profile
    const command = agent.runtime_family === 'pi' ? 'pi-acp' : (agent.config as any)?.command ?? 'acp-agent'
    const args = (agent.runtime_family === 'pi' ? [] : ((agent.config as any)?.args ?? [])) as string[]
    const permissionConfig = (agent.config as any)?.permission ?? {}

    // Behind CREDENTIAL_BROKER: issue brokered credentials for this agent's lifecycle
    // (revoked at teardown). No-op when the flag is off. (ACP env injection lands with
    // the runtime-container launcher, T062.)
    await provisionAgentCredentials(
      this.broker,
      agent.id,
      await this.buildCredentialScope(agent, provider),
      this.credentialBrokerEnabled,
    )

    if (this.launcherDefaultEnabled) {
      // Launcher-managed remote ACP transport is now the default path.
      // The launcher provisions the runtime and returns an ACP endpoint for the harness to connect.
      try {
        const { createLauncherClient } = await import('../runtime/launcher-client.js')
        const launcherClient = createLauncherClient(this.launcherUrl)

        console.log(`[process-manager] Provisioning launcher-managed runtime for agent ${agent.id}`)
        const provisionResult = await launcherClient.provisionRuntime({
          agentId: agent.id,
          runtimeFamily: 'opencode' as const,
          workdir: workspaceRoot,
          env: {
            AGENT_ID: agent.id,
            WORKDIR: workspaceRoot,
            RUNTIME_FAMILY: 'opencode',
          },
          expectedMounts: [
            { path: workspaceRoot, mode: 'rw' as const, purpose: 'worktree' },
            { path: '/tmp/launcher-scratch', mode: 'rw' as const, purpose: 'scratch' },
          ],
          networkPolicy: { mode: 'default-deny' as const, allowlist: [] },
          runtimeImage: process.env.OPENSANDBOX_IMAGE_OPENCODE,
        })

        console.log(`[process-manager] Runtime provisioned for agent ${agent.id}: ${provisionResult.acpEndpoint.protocol}://${provisionResult.acpEndpoint.host}:${provisionResult.acpEndpoint.port}${provisionResult.acpEndpoint.path}`)

        const harness = new AcpHarness(
          agent.id,
          this.pool,
          command,
          args,
          workspaceRoot,
          permissionConfig,
          {
            protocol: provisionResult.acpEndpoint.protocol,
            host: provisionResult.acpEndpoint.host,
            port: provisionResult.acpEndpoint.port,
            path: provisionResult.acpEndpoint.path,
          },
        )

        await harness.start({
          cwd: workspaceRoot,
          model: { providerID: provider?.type ?? 'openai', id: model },
        })

        console.log(`[process-manager] Launcher-managed AcpHarness started for agent ${agent.id} (${agent.name})`)
        this.harnesses.set(agent.id, harness)
        return
      } catch (error) {
        console.error(
          `[process-manager] Failed to provision launcher runtime for agent ${agent.id}:`,
          error,
        )
        // Fall back to local stdio transport if launcher fails
        console.warn(`[process-manager] Falling back to local runtime for agent ${agent.id}`)
      }
    }

    console.log(`[process-manager] Selecting AcpHarness for agent ${agent.id} (${agent.name})`)
    const harness = new AcpHarness(agent.id, this.pool, command, args, workspaceRoot, permissionConfig)
    // Pi agents communicate model/provider via PI_MODEL and PI_PROVIDER env vars (FR-010).
    const piEnv: Record<string, string> | undefined = agent.runtime_family === 'pi'
      ? {
          ...(model ? { PI_MODEL: model } : {}),
          ...(provider?.type ? { PI_PROVIDER: provider.type } : {}),
        }
      : undefined
    try {
      await harness.start({
        cwd: worktreePath,
        model: { providerID: provider?.type ?? 'openai', id: model },
        env: piEnv,
      })
    } catch (err) {
      if (agent.runtime_family === 'pi' && err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          `Pi ACP startup failed: 'pi-acp' executable not found. ` +
          `Ensure the pi-acp package is installed in the runtime environment. Original: ${err.message}`
        )
      }
      throw err
    }
    console.log(`[process-manager] AcpHarness spawned for agent ${agent.id} (${agent.name})`)
    this.harnesses.set(agent.id, harness)
  }

  private async retryStart(agent: RegistryAgent, restartAttempts: number): Promise<void> {
    const refreshed = await this.refreshAgent(agent.id) ?? agent
    if (!isManagedLocalAgent(refreshed)) return
    if (!refreshed.local_port || !refreshed.worktree_path) {
      throw new Error(`local agent ${refreshed.name} is missing local_port or worktree_path`)
    }

    await this.setAgentState(refreshed.id, 'provisioning', `retrying managed local runtime (attempt ${restartAttempts + 1})`)

    const provider = await this.resolveProvider(refreshed)
    const providerKey = provider ? await getProviderApiKey(this.pool, provider.id) : null
    const providerEnv = providerEnvName(provider)
    const brokerEnv = await provisionAgentCredentials(
      this.broker,
      refreshed.id,
      await this.buildCredentialScope(refreshed, provider),
      this.credentialBrokerEnabled,
    )
    const controlPlaneToken = this.credentialBrokerEnabled
      ? brokerEnv.CONTROL_PLANE_AGENT_TOKEN
      : await getOrCreateAgentToken(this.pool, refreshed.id)
    const env = {
      ...process.env,
      ...(providerEnv && providerKey ? { [providerEnv]: providerKey } : {}),
      ...(provider?.base_url && isOpenAiCompatibleProviderType(provider.type) ? { OPENAI_BASE_URL: provider.base_url } : {}),
      CONTROL_PLANE_URL: this.controlPlaneUrl,
      ...(controlPlaneToken ? { CONTROL_PLANE_AGENT_TOKEN: controlPlaneToken } : {}),
      POSTGRES_URL: process.env.DATABASE_URL ?? '',
      SOULLAYER_AGENT_ID: refreshed.id,
      ...brokerEnv,
    }

    await this.launchManagedProcess(refreshed, refreshed.local_port, refreshed.worktree_path, env, restartAttempts)
    await this.setAgentState(refreshed.id, refreshed.tier === 'ephemeral' ? 'ready' : 'idle', `managed local runtime recovered after restart ${restartAttempts + 1}`)
  }

  private async refreshAgent(agentId: string): Promise<RegistryAgent | null> {
    const { rows } = await this.pool.query<RegistryAgent>('SELECT * FROM agents WHERE id = $1', [agentId])
    return rows[0] ?? null
  }

  private async waitForHealth(port: number): Promise<void> {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS
    while (Date.now() < deadline) {
      try {
        const res = await this.fetchFn(`http://127.0.0.1:${port}/health`)
        if (res.ok) return
      } catch {
        // keep polling
      }
      await this.sleepFn(HEALTH_INTERVAL_MS)
    }
    throw new Error(`opencode serve on port ${port} did not become healthy within ${HEALTH_TIMEOUT_MS}ms`)
  }

  private async recoverLifecycleState(): Promise<void> {
    // Resume durable / re-dispatch ephemeral in-flight delegations from the durable log
    // instead of failing them. recoverInflight emits its own events and leaves resumed
    // agents to re-provision on dispatch (not marked 'error').
    await recoverInflight(this.pool)

    const { rows: unstableAgents } = await this.pool.query<{ id: string }>(
      `SELECT id
       FROM agents
       WHERE COALESCE(is_prime, false) = false
         AND state IN ('provisioning', 'busy', 'retiring')`,
    )

    const recoverableAgentIds = Array.from(new Set(unstableAgents.map((agent) => agent.id)))
    for (const agentId of recoverableAgentIds) {
      await this.setAgentState(agentId, 'error', RECOVERY_ERROR)
    }
  }

  private async launchManagedProcess(
    agent: RegistryAgent,
    localPort: number,
    worktreePath: string,
    env: NodeJS.ProcessEnv,
    restartAttempts: number,
  ): Promise<void> {
    const child = this.spawnFn('opencode', ['serve', '--port', String(localPort)], {
      cwd: worktreePath,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const state: ProcessState = { child, restartAttempts, stopped: false }
    this.processes.set(agent.id, state)

    child.on('close', () => {
      const current = this.processes.get(agent.id)
      if (!current || current.child !== child) return
      this.processes.delete(agent.id)
      if (current.stopped) return
      void this.handleUnexpectedExit(agent, current.restartAttempts)
    })

    try {
      await this.waitForHealth(localPort)
    } catch (error) {
      const current = this.processes.get(agent.id)
      if (current?.child === child) {
        current.stopped = true
        current.child.kill()
        this.processes.delete(agent.id)
      }
      throw error
    }
  }

  private async handleUnexpectedExit(agent: RegistryAgent, restartAttempts: number): Promise<void> {
    const nextAttempt = restartAttempts + 1
    const message = `managed local runtime exited unexpectedly (attempt ${nextAttempt} of ${START_RETRIES})`
    await this.setAgentState(agent.id, 'error', message)

    if (nextAttempt >= START_RETRIES) return

    try {
      await this.retryStart(agent, restartAttempts + 1)
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error)
      await this.setAgentState(agent.id, 'error', `restart failed: ${failure}`)
    }
  }

  private async setAgentState(agentId: string, state: AgentState, reason: string): Promise<void> {
    await this.pool.query(
      `UPDATE agents
       SET state = $2
       WHERE id = $1
         AND COALESCE(is_prime, false) = false`,
      [agentId, state],
    )
    await this.recordRuntimeEvent('agent.lifecycle.transition', {
      actor: 'process-manager',
      payload: { agent_id: agentId, state, reason },
    })
  }

  private async recordRuntimeEvent(
    eventType: string,
    event: { actor: string; delegation_id?: string; payload: Record<string, unknown> },
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO runtime_events (event_type, actor, delegation_id, payload)
       VALUES ($1, $2, $3, $4)`,
      [eventType, event.actor, event.delegation_id ?? null, JSON.stringify(event.payload)],
    )
  }
}
