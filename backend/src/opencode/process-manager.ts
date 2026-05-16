import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type pg from 'pg'
import { getOrCreateAgentToken } from '../agent-tokens.js'
import { decryptEnvVars } from '../mcp-registry.js'
import { listControlPlaneTools, type McpToolDefinition } from '../mcp/service.js'
import {
  getProviderApiKey,
  type Provider,
  type RegistryAgent,
  updateAgent,
} from '../registry.js'
import { PiHarness } from '../fleet-executor/pi-harness.js'
import type { AgentHarness } from '../fleet-executor/harness.js'

const execFileAsync = promisify(execFile)
const DEFAULT_PORT_START = 4200
const DEFAULT_REPO_ROOT = '/workspace/repo'
const DEFAULT_AGENTS_ROOT = '/workspace/agents'
const DEFAULT_CONTROL_PLANE_URL = 'http://localhost:3100'
const START_RETRIES = 3
const HEALTH_TIMEOUT_MS = 10_000
const HEALTH_INTERVAL_MS = 500

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
    )
}

function defaultAgentInstructions(agent: RegistryAgent): string {
  return agent.system_prompt?.trim() || `# Agent Instructions

You are ${agent.name}.
Work carefully, keep updates concise, and use the control plane as the source of truth.
`
}

function defaultSoul(agent: RegistryAgent): string {
  return agent.soul?.trim() || `# Soul

Identity and values for ${agent.name} have not been configured yet.
`
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
  if (provider.type === 'openai' || provider.type === 'codex') return 'OPENAI_API_KEY'
  if (provider.type === 'llm' && typeof provider.model === 'string' && provider.model.startsWith('anthropic/')) {
    return 'ANTHROPIC_API_KEY'
  }
  if (provider.type === 'llm') return 'OPENAI_API_KEY'
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
  private readonly piHarnesses = new Map<string, PiHarness>()

  constructor(
    private readonly pool: pg.Pool,
    deps: ProcessManagerDeps = {},
  ) {
    this.repoRoot = deps.repoRoot ?? process.env.AGENT_REPO_ROOT ?? DEFAULT_REPO_ROOT
    this.agentsRoot = deps.agentsRoot ?? process.env.AGENT_WORKTREE_ROOT ?? DEFAULT_AGENTS_ROOT
    this.controlPlaneUrl = deps.controlPlaneUrl ?? process.env.CONTROL_PLANE_URL ?? DEFAULT_CONTROL_PLANE_URL
    this.spawnFn = deps.spawnFn ?? spawn
    this.fetchFn = deps.fetchFn ?? fetch
    this.execFileFn = deps.execFileFn ?? execFileAsync
    this.sleepFn = deps.sleepFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  async initialize(): Promise<void> {
    const { rows } = await this.pool.query<RegistryAgent>('SELECT * FROM agents ORDER BY created_at')
    for (const agent of rows) {
      await this.syncAgent(agent)
    }
  }

  async syncAgent(agent: RegistryAgent): Promise<RegistryAgent> {
    if (!isManagedLocalAgent(agent)) {
      this.stopAgent(agent.id)
      return agent
    }

    const preparedAgent = await this.prepareAgent(agent)
    await this.ensureWorktree(preparedAgent)
    await this.writeConfigFiles(preparedAgent)

    const existing = this.processes.get(preparedAgent.id)
    if (existing) {
      return preparedAgent
    }

    await this.startAgent(preparedAgent)
    return preparedAgent
  }

  getRunningHarness(agentId: string): AgentHarness | undefined {
    return this.piHarnesses.get(agentId)
  }

  stopAgent(agentId: string): void {
    const piHarness = this.piHarnesses.get(agentId)
    if (piHarness) {
      void piHarness.close()
      this.piHarnesses.delete(agentId)
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
    const controlPlaneToken = await getOrCreateAgentToken(this.pool, agent.id)
    const model = await this.resolveModel(agent)
    const controlPlaneTools = await listControlPlaneTools()

    await mkdir(worktreePath, { recursive: true })
    await writeFile(path.join(worktreePath, 'AGENTS.md'), `${defaultAgentInstructions(agent).trim()}\n`)
    await writeFile(path.join(worktreePath, 'soul.md'), `${defaultSoul(agent).trim()}\n`)
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
            CONTROL_PLANE_AGENT_TOKEN: controlPlaneToken,
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
                env: normalizeEnvVars(server.env_vars),
              }
            : {
                type: 'stdio',
                command: server.command,
                args: server.args ?? [],
                env: normalizeEnvVars(server.env_vars),
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
    if (agent.runtime_family === 'pi') {
      return this.startPiAgent(agent)
    }

    const localPort = agent.local_port
    const worktreePath = agent.worktree_path
    if (!localPort || !worktreePath) {
      throw new Error(`local agent ${agent.name} is missing local_port or worktree_path`)
    }

    const provider = await this.resolveProvider(agent)
    const providerKey = provider ? await getProviderApiKey(this.pool, provider.id) : null
    const providerEnv = providerEnvName(provider)
    const controlPlaneToken = await getOrCreateAgentToken(this.pool, agent.id)

    const child = this.spawnFn('opencode', ['serve', '--port', String(localPort)], {
      cwd: worktreePath,
      env: {
        ...process.env,
        ...(providerEnv && providerKey ? { [providerEnv]: providerKey } : {}),
        ...(provider?.type === 'llm' && provider.base_url ? { OPENAI_BASE_URL: provider.base_url } : {}),
        CONTROL_PLANE_URL: this.controlPlaneUrl,
        CONTROL_PLANE_AGENT_TOKEN: controlPlaneToken,
        POSTGRES_URL: process.env.DATABASE_URL ?? '',
        SOULLAYER_AGENT_ID: agent.id,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const state: ProcessState = { child, restartAttempts: 0, stopped: false }
    this.processes.set(agent.id, state)

    child.on('close', () => {
      const current = this.processes.get(agent.id)
      if (!current || current.child !== child) return
      this.processes.delete(agent.id)
      if (current.stopped) return
      if (current.restartAttempts >= START_RETRIES - 1) return
      current.restartAttempts += 1
      void this.retryStart(agent, current.restartAttempts)
    })

    await this.waitForHealth(localPort)
  }

  private async startPiAgent(agent: RegistryAgent): Promise<void> {
    const worktreePath = agent.worktree_path
    if (!worktreePath) throw new Error(`worktree_path missing for pi agent ${agent.name}`)

    const provider = await this.resolveProvider(agent)
    const model = await this.resolveModel(agent)

    const harness = new PiHarness()
    await harness.start({
      cwd: worktreePath,
      model: { providerID: provider?.type ?? 'openai', id: model },
    })
    this.piHarnesses.set(agent.id, harness)
  }

  private async retryStart(agent: RegistryAgent, restartAttempts: number): Promise<void> {
    const refreshed = await this.refreshAgent(agent.id) ?? agent
    if (!isManagedLocalAgent(refreshed)) return
    const child = this.spawnFn('opencode', ['serve', '--port', String(refreshed.local_port)], {
      cwd: refreshed.worktree_path,
      env: {
        ...process.env,
        CONTROL_PLANE_URL: this.controlPlaneUrl,
        SOULLAYER_AGENT_ID: refreshed.id,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const state: ProcessState = { child, restartAttempts, stopped: false }
    this.processes.set(refreshed.id, state)
    child.on('close', () => {
      const current = this.processes.get(refreshed.id)
      if (!current || current.child !== child) return
      this.processes.delete(refreshed.id)
    })
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
}
