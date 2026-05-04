import { Router } from 'express'
import pg from 'pg'
import { listAgents, getAgent, insertAgent, updateAgent, deleteAgent, RegistryAgent } from '../registry.js'
import { makeExecOnAgent, dockerLifecycle, SshExecFn } from '../lifecycle.js'

interface AgentsRouterDeps {
  pool: pg.Pool
  sshKeyPath: string
  sshUser: string
  execFn?: SshExecFn  // optional injection for testing
  onAgentCreated: (agent: RegistryAgent) => void
  onAgentDeleted: (id: string) => void
}

export function createAgentsRouter(deps: AgentsRouterDeps) {
  const router = Router()
  const exec = deps.execFn ?? makeExecOnAgent(deps.sshKeyPath)

  router.get('/', async (_req, res) => {
    try {
      const agents = await listAgents(deps.pool)
      res.json(agents)
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.post('/', async (req, res) => {
    const { name, type, provider_id, host, container_name, ssh_user, config, enabled } = req.body
    if (!name || !type) return res.status(400).json({ error: 'name and type required' })
    try {
      const agent = await insertAgent(deps.pool, { name, type, provider_id, host, container_name, ssh_user, config: config ?? {}, enabled: enabled ?? true })
      deps.onAgentCreated(agent)
      res.status(201).json(agent)
    } catch (err) {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.put('/:id', async (req, res) => {
    try {
      const agent = await updateAgent(deps.pool, req.params.id, req.body)
      res.json(agent)
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

  return router
}
