import { Router } from 'express'
import type pg from 'pg'
import { runAuditLoop } from '../audits.js'
import { handleChiefMessage } from '../coordinator.js'
import { runDelegation } from '../delegation-runner.js'
import {
  listFleetLearnings,
  listFleetLoopWarnings,
  listFleetSnapshots,
  listPatterns,
} from '../fleet-intelligence.js'
import { detectLoopWarnings, getLoopWarningDrilldown } from '../loop-detector.js'
import { listLessons, listMemoryTimeline, listSnapshots } from '../memory-service.js'
import { callControlPlaneTool, createPrimePortalContext } from '../mcp/service.js'
import {
  appendThreadMessage,
  createDelegation,
  createMemory,
  createThread,
  createWorkItem,
  getRuntimeOverview,
  listAuditLoops,
  listDelegations,
  listMemories,
  listRuntimeEvents,
  listThreadMessages,
  listThreads,
  listWorkItems,
  updateWorkItem,
} from '../runtime.js'

export function createRuntimeRouter({ pool }: { pool: pg.Pool }) {
  const router = Router()

  router.get('/runtime/overview', async (_req, res) => {
    try {
      res.json(await getRuntimeOverview(pool))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/runtime/events', async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 100
    if (Number.isNaN(limit)) return res.status(400).json({ error: 'limit must be a number' })
    try {
      res.json(await listRuntimeEvents(pool, limit))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/threads', async (_req, res) => {
    try {
      res.json(await listThreads(pool))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.post('/threads', async (req, res) => {
    const { title, status, metadata } = req.body ?? {}
    if (!title) return res.status(400).json({ error: 'title required' })
    try {
      res.status(201).json(await createThread(pool, { title, status, metadata }))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/threads/:id/messages', async (req, res) => {
    try {
      res.json(await listThreadMessages(pool, req.params.id))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.post('/threads/:id/messages', async (req, res) => {
    const { role, sender, content, metadata } = req.body ?? {}
    if (!role || !sender || !content) {
      return res.status(400).json({ error: 'role, sender, content required' })
    }
    try {
      res.status(201).json(await appendThreadMessage(pool, req.params.id, { role, sender, content, metadata }))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.post('/threads/:id/chief/messages', async (req, res) => {
    const { content, sender } = req.body ?? {}
    if (!content) return res.status(400).json({ error: 'content required' })
    try {
      res.status(201).json(await handleChiefMessage(pool, req.params.id, content, sender ?? 'james'))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/work-items', async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined
    try {
      res.json(await listWorkItems(pool, status))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.post('/work-items', async (req, res) => {
    const { title } = req.body ?? {}
    if (!title) return res.status(400).json({ error: 'title required' })
    try {
      res.status(201).json(await createWorkItem(pool, req.body))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.put('/work-items/:id', async (req, res) => {
    try {
      const item = await updateWorkItem(pool, req.params.id, req.body ?? {})
      if (!item) return res.status(404).json({ error: 'work item not found' })
      res.json(item)
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/delegations', async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined
    try {
      res.json(await listDelegations(pool, status))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.post('/delegations', async (req, res) => {
    const { capability } = req.body ?? {}
    if (!capability) return res.status(400).json({ error: 'capability required' })
    try {
      res.status(201).json(await createDelegation(pool, req.body))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.post('/delegations/:id/run', async (req, res) => {
    try {
      res.status(202).json(await runDelegation(pool, req.params.id))
    } catch (err) {
      if ((err as Error).message === 'delegation not found') {
        return res.status(404).json({ error: 'delegation not found' })
      }
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/memory', async (req, res) => {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined
    try {
      res.json(await listMemories(pool, category))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.post('/memory', async (req, res) => {
    const { category, content } = req.body ?? {}
    if (!category || !content) return res.status(400).json({ error: 'category and content required' })
    try {
      res.status(201).json(await createMemory(pool, req.body))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/fleet/patterns', async (req, res) => {
    const agentId = typeof req.query.agent_id === 'string' ? req.query.agent_id : undefined
    try {
      res.json(await listPatterns(pool, agentId))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/fleet/learnings', async (req, res) => {
    const agentId = typeof req.query.agent_id === 'string' ? req.query.agent_id : undefined
    const query = typeof req.query.query === 'string' ? req.query.query : undefined
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    if (limit != null && Number.isNaN(limit)) return res.status(400).json({ error: 'limit must be a number' })
    try {
      res.json(await listFleetLearnings(pool, { agentId, query, limit }))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/fleet/loop-warnings', async (req, res) => {
    const agentId = typeof req.query.agent_id === 'string' ? req.query.agent_id : undefined
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    if (limit != null && Number.isNaN(limit)) return res.status(400).json({ error: 'limit must be a number' })
    try {
      res.json(await listFleetLoopWarnings(pool, { agentId, limit }))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/fleet/snapshots', async (req, res) => {
    const agentId = typeof req.query.agent_id === 'string' ? req.query.agent_id : undefined
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    if (limit != null && Number.isNaN(limit)) return res.status(400).json({ error: 'limit must be a number' })
    try {
      res.json(await listFleetSnapshots(pool, { agentId, limit }))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.post('/fleet/patterns/publish', async (req, res) => {
    try {
      const ctx = await createPrimePortalContext(pool)
      const result = await callControlPlaneTool(pool, ctx, 'publish_pattern', req.body ?? {})
      res.status(201).json(result)
    } catch (err) {
      const message = (err as Error).message
      if (message === 'no prime agent available') return res.status(409).json({ error: message })
      if (message === 'content is required') return res.status(400).json({ error: message })
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/agents/:id/loop-warnings', async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    if (limit != null && Number.isNaN(limit)) return res.status(400).json({ error: 'limit must be a number' })
    try {
      res.json(await detectLoopWarnings(pool, req.params.id, { limit }))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/agents/:id/loop-warnings/:warningId', async (req, res) => {
    try {
      const drilldown = await getLoopWarningDrilldown(pool, req.params.id, req.params.warningId)
      if (!drilldown) return res.status(404).json({ error: 'loop warning not found' })
      res.json(drilldown)
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/agents/:id/memories', async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    if (limit != null && Number.isNaN(limit)) return res.status(400).json({ error: 'limit must be a number' })
    try {
      res.json(await listMemoryTimeline(pool, req.params.id, { limit }))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/agents/:id/lessons', async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    if (limit != null && Number.isNaN(limit)) return res.status(400).json({ error: 'limit must be a number' })
    try {
      res.json(await listLessons(pool, req.params.id, { limit }))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/agents/:id/snapshots', async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    if (limit != null && Number.isNaN(limit)) return res.status(400).json({ error: 'limit must be a number' })
    try {
      res.json(await listSnapshots(pool, req.params.id, limit))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/audit-loops', async (_req, res) => {
    try {
      res.json(await listAuditLoops(pool))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.post('/audit-loops/:id/run', async (req, res) => {
    try {
      res.status(201).json(await runAuditLoop(pool, req.params.id))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  return router
}
