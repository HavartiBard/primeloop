import { Router } from 'express'
import pg from 'pg'
import { getOrCreateAgentToken, rotateAgentToken } from '../agent-tokens.js'
import { listAgents, getAgent, insertAgent, updateAgent, deleteAgent, RegistryAgent } from '../registry.js'
import { makeExecOnAgent, dockerLifecycle, SshExecFn } from '../lifecycle.js'
import { createAgentAdapter } from '../adapters/index.js'
import { listAgentMcpAssignments, setAgentMcpAssignments } from '../mcp-registry.js'

interface AgentsRouterDeps {
  pool: pg.Pool
  sshKeyPath: string
  sshUser: string
  execFn?: SshExecFn  // optional injection for testing
  onAgentCreated: (agent: RegistryAgent) => void
  onAgentUpdated?: (agent: RegistryAgent) => void
  onAgentDeleted: (id: string) => void
}

export function createAgentsRouter(deps: AgentsRouterDeps) {
  const router = Router()
  const exec = deps.execFn ?? makeExecOnAgent(deps.sshKeyPath)

  const withAssignments = async <T extends RegistryAgent>(agents: T[]): Promise<Array<T & { mcp_server_ids: string[] }>> => {
    const assignmentMap = await listAgentMcpAssignments(deps.pool, agents.map((agent) => agent.id))
    return agents.map((agent) => ({
      ...agent,
      mcp_server_ids: assignmentMap[agent.id] ?? [],
    }))
  }

  router.get('/', async (_req, res) => {
    try {
      const agents = await listAgents(deps.pool)
      res.json(await withAssignments(agents))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.post('/', async (req, res) => {
    const {
      name,
      type,
      provider_id,
      runtime_family,
      execution_mode,
      endpoint,
      capabilities,
      host,
      container_name,
      ssh_user,
      local_port,
      worktree_path,
      system_prompt,
      soul,
      mcp_server_ids,
      config,
      enabled,
    } = req.body
    if (!name || !type) return res.status(400).json({ error: 'name and type required' })
    try {
      const agent = await insertAgent(deps.pool, {
        name,
        type,
        provider_id,
        runtime_family: runtime_family ?? 'custom',
        execution_mode: execution_mode ?? 'external',
        endpoint,
        capabilities: Array.isArray(capabilities) ? capabilities : [],
        host,
        container_name,
        ssh_user,
        local_port,
        worktree_path,
        system_prompt,
        soul,
        config: config ?? {},
        enabled: enabled ?? true,
      })
      await setAgentMcpAssignments(deps.pool, agent.id, Array.isArray(mcp_server_ids) ? mcp_server_ids : [])
      deps.onAgentCreated(agent)
      res.status(201).json({ ...agent, mcp_server_ids: Array.isArray(mcp_server_ids) ? mcp_server_ids : [] })
    } catch (err) {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.put('/:id', async (req, res) => {
    try {
      const agent = await updateAgent(deps.pool, req.params.id, req.body)
      if (Array.isArray(req.body?.mcp_server_ids)) {
        await setAgentMcpAssignments(deps.pool, agent.id, req.body.mcp_server_ids)
      }
      deps.onAgentUpdated?.(agent)
      const assignmentMap = await listAgentMcpAssignments(deps.pool, [agent.id])
      res.json({ ...agent, mcp_server_ids: assignmentMap[agent.id] ?? [] })
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.delete('/:id', async (req, res) => {
    try {
      await deleteAgent(deps.pool, req.params.id)
      deps.onAgentDeleted(req.params.id)
      res.status(204).send()
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.post('/:id/lifecycle', async (req, res) => {
    const { action } = req.body
    if (!['restart', 'stop', 'start'].includes(action)) {
      return res.status(400).json({ error: 'action must be restart, stop, or start' })
    }
    try {
      const agent = await getAgent(deps.pool, req.params.id)
      if (!agent) return res.status(404).json({ error: 'agent not found' })
      if (!agent.host || !agent.container_name) {
        return res.status(400).json({ error: 'agent has no host or container_name configured' })
      }
      const result = await dockerLifecycle(exec, agent.host, agent.ssh_user ?? deps.sshUser, agent.container_name, action as 'restart' | 'stop' | 'start')
      res.json(result)
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/:id/runtime/discover', async (req, res) => {
    try {
      const agent = await getAgent(deps.pool, req.params.id)
      if (!agent) return res.status(404).json({ error: 'agent not found' })
      const adapter = createAgentAdapter(agent)
      res.json(await adapter.discover(agent))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/:id/runtime/health', async (req, res) => {
    try {
      const agent = await getAgent(deps.pool, req.params.id)
      if (!agent) return res.status(404).json({ error: 'agent not found' })
      const adapter = createAgentAdapter(agent)
      res.json(await adapter.health(agent))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.post('/:id/control-plane-token', async (req, res) => {
    try {
      const agent = await getAgent(deps.pool, req.params.id)
      if (!agent) return res.status(404).json({ error: 'agent not found' })
      const rotate = req.body?.rotate === true
      const token = rotate
        ? await rotateAgentToken(deps.pool, agent.id)
        : await getOrCreateAgentToken(deps.pool, agent.id)
      res.json({
        agent_id: agent.id,
        token,
        endpoint: '/api/control-plane/tools',
        auth_scheme: 'Bearer',
      })
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  return router
}
