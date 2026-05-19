import { Router } from 'express'
import type pg from 'pg'
import { getPrimeConfig, updatePrimeConfig } from '../prime-agent/config.js'
import type { PrimeEvent } from '../prime-agent/events.js'
import {
  getPrimeModuleConfig,
  listPrimeModuleConfigAudits,
  listPrimeModuleConfigs,
  updatePrimeModuleConfig,
} from '../prime-agent/modules/registry.js'
import type { PrimeQueue } from '../prime-agent/queue.js'
import { getPrimeSession, listPrimeSessions } from '../prime-agent/session.js'
import {
  ensureWorkspaceScaffold,
  getWorkspaceStatus,
  listWorkspaceFiles,
  readWorkspaceFile,
  updateWorkspaceConfig,
  WorkspaceVersionConflictError,
  writeWorkspaceFile,
} from '../workspace.js'

export function createPrimeAgentRouter(
  { pool, queue, onConfigUpdated }: { pool: pg.Pool; queue: PrimeQueue; onConfigUpdated?: () => Promise<void> | void }
) {
  const router = Router()

  router.get('/config', async (_req, res) => {
    try {
      res.json(await getPrimeConfig(pool))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.patch('/config', async (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'config patch object required' })
    }

    try {
      const patch = validatePrimeConfigPatch(req.body)
      const config = await updatePrimeConfig(pool, patch)
      await onConfigUpdated?.()
      res.json(config)
    } catch (err) {
      const message = (err as Error).message
      if (message.startsWith('invalid prime config patch')) {
        return res.status(400).json({ error: message })
      }
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/sessions', async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    if (limit !== undefined && Number.isNaN(limit)) {
      return res.status(400).json({ error: 'limit must be a number' })
    }

    try {
      res.json(await listPrimeSessions(pool, limit))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/sessions/:id', async (req, res) => {
    try {
      const session = await getPrimeSession(pool, req.params.id)
      if (!session) {
        return res.status(404).json({ error: 'prime session not found' })
      }
      res.json(session)
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/modules', async (_req, res) => {
    try {
      res.json(await listPrimeModuleConfigs(pool))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.patch('/modules/:id', async (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'module patch object required' })
    }

    try {
      const patch = validatePrimeModulePatch(req.body)
      const existing = await getPrimeModuleConfig(pool, req.params.id)
      if (!existing) {
        return res.status(404).json({ error: 'prime module not found' })
      }

      const actor = req.header('x-prime-actor')?.trim() || 'api'
      const config = await updatePrimeModuleConfig(pool, req.params.id, patch, actor)
      res.json(config)
    } catch (err) {
      const message = (err as Error).message
      if (message.startsWith('invalid prime module patch')) {
        return res.status(400).json({ error: message })
      }
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/modules/:id/audit', async (req, res) => {
    try {
      const existing = await getPrimeModuleConfig(pool, req.params.id)
      if (!existing) {
        return res.status(404).json({ error: 'prime module not found' })
      }
      const limit = req.query.limit ? Number(req.query.limit) : undefined
      if (limit !== undefined && Number.isNaN(limit)) {
        return res.status(400).json({ error: 'limit must be a number' })
      }
      res.json(await listPrimeModuleConfigAudits(pool, req.params.id, limit))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.post('/events', async (req, res) => {
    try {
      const config = await getPrimeConfig(pool)
      if (!config.enabled) {
        return res.status(409).json({ error: 'prime agent is disabled' })
      }

      const event = validatePrimeEvent(req.body)
      await queue.enqueue(event)
      res.status(202).json({ queued: true, event_type: event.type })
    } catch (err) {
      const message = (err as Error).message
      if (message.startsWith('invalid prime event')) {
        return res.status(400).json({ error: message })
      }
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/workspace', async (_req, res) => {
    try {
      res.json(await getWorkspaceStatus(pool))
    } catch (err) {
      res.status(500).json({ error: (err as Error).message ?? 'internal error' })
    }
  })

  router.post('/workspace/init', async (_req, res) => {
    try {
      res.json(await ensureWorkspaceScaffold(pool))
    } catch (err) {
      res.status(500).json({ error: (err as Error).message ?? 'internal error' })
    }
  })

  router.patch('/workspace', async (req, res) => {
    const body = req.body as {
      mode?: 'local' | 'git'
      root_path?: string
      remote_url?: string | null
      branch?: string
    }

    try {
      const config = await updateWorkspaceConfig(pool, {
        ...(body.mode ? { mode: body.mode } : {}),
        ...(body.root_path ? { root_path: body.root_path } : {}),
        ...(body.remote_url !== undefined ? { remote_url: body.remote_url } : {}),
        ...(body.branch ? { branch: body.branch } : {}),
      })
      await ensureWorkspaceScaffold(pool)
      res.json(config)
    } catch (err) {
      res.status(500).json({ error: (err as Error).message ?? 'internal error' })
    }
  })

  router.get('/workspace/files', async (_req, res) => {
    try {
      res.json({ files: await listWorkspaceFiles(pool) })
    } catch (err) {
      res.status(500).json({ error: (err as Error).message ?? 'internal error' })
    }
  })

  router.get('/workspace/file', async (req, res) => {
    const targetPath = typeof req.query.path === 'string' ? req.query.path : ''
    if (!targetPath) return res.status(400).json({ error: 'path required' })
    try {
      res.json(await readWorkspaceFile(pool, targetPath))
    } catch (err) {
      res.status(500).json({ error: (err as Error).message ?? 'internal error' })
    }
  })

  router.put('/workspace/file', async (req, res) => {
    const body = req.body as { path?: string; content?: string; expected_version?: string }
    if (!body.path || typeof body.content !== 'string') {
      return res.status(400).json({ error: 'path and content required' })
    }
    try {
      res.json(await writeWorkspaceFile(pool, body.path, body.content, body.expected_version))
    } catch (err) {
      if (err instanceof WorkspaceVersionConflictError) {
        return res.status(409).json({ error: err.message })
      }
      res.status(500).json({ error: (err as Error).message ?? 'internal error' })
    }
  })

  return router
}

function validatePrimeConfigPatch(value: unknown) {
  if (!isRecord(value)) {
    throw new Error('invalid prime config patch: body must be an object')
  }

  const patch: {
    enabled?: boolean
    cron_fast_interval_seconds?: number
    cron_slow_interval_seconds?: number
    debounce_window_ms?: number
    provider_routing?: Record<string, { provider_id: string; model: string }[]>
    cost_controls?: Record<string, unknown>
    git_store?: Record<string, unknown>
    status?: string
    last_started_at?: string | null
    last_error?: string | null
  } = {}

  if ('enabled' in value) {
    if (typeof value.enabled !== 'boolean') {
      throw new Error('invalid prime config patch: enabled must be a boolean')
    }
    patch.enabled = value.enabled
  }

  if ('cron_fast_interval_seconds' in value) {
    patch.cron_fast_interval_seconds = requireFiniteNumber(
      value.cron_fast_interval_seconds,
      'cron_fast_interval_seconds'
    )
  }

  if ('cron_slow_interval_seconds' in value) {
    patch.cron_slow_interval_seconds = requireFiniteNumber(
      value.cron_slow_interval_seconds,
      'cron_slow_interval_seconds'
    )
  }

  if ('debounce_window_ms' in value) {
    patch.debounce_window_ms = requireFiniteNumber(value.debounce_window_ms, 'debounce_window_ms')
  }

  if ('provider_routing' in value) {
    if (!isRecord(value.provider_routing)) {
      throw new Error('invalid prime config patch: provider_routing must be an object')
    }

    patch.provider_routing = Object.fromEntries(
      Object.entries(value.provider_routing).map(([routeName, routes]) => {
        if (!Array.isArray(routes)) {
          throw new Error(`invalid prime config patch: provider_routing.${routeName} must be an array`)
        }

        return [
          routeName,
          routes.map((route, index) => {
            if (!isRecord(route) || typeof route.provider_id !== 'string' || typeof route.model !== 'string') {
              throw new Error(
                `invalid prime config patch: provider_routing.${routeName}[${index}] must include string provider_id and model`
              )
            }

            return {
              provider_id: route.provider_id,
              model: route.model,
            }
          }),
        ]
      })
    )
  }

  if ('cost_controls' in value) {
    if (!isRecord(value.cost_controls)) {
      throw new Error('invalid prime config patch: cost_controls must be an object')
    }
    patch.cost_controls = value.cost_controls
  }

  if ('git_store' in value) {
    if (!isRecord(value.git_store)) {
      throw new Error('invalid prime config patch: git_store must be an object')
    }
    patch.git_store = value.git_store
  }

  if ('status' in value) {
    if (typeof value.status !== 'string') {
      throw new Error('invalid prime config patch: status must be a string')
    }
    patch.status = value.status
  }

  if ('last_started_at' in value) {
    if (value.last_started_at !== null && typeof value.last_started_at !== 'string') {
      throw new Error('invalid prime config patch: last_started_at must be a string or null')
    }
    patch.last_started_at = value.last_started_at
  }

  if ('last_error' in value) {
    if (value.last_error !== null && typeof value.last_error !== 'string') {
      throw new Error('invalid prime config patch: last_error must be a string or null')
    }
    patch.last_error = value.last_error
  }

  return patch
}

function validatePrimeModulePatch(value: unknown) {
  if (!isRecord(value)) {
    throw new Error('invalid prime module patch: body must be an object')
  }

  const patch: {
    pinned_version?: string | null
    enabled?: boolean
    rollout_mode?: 'active' | 'shadow'
    config?: Record<string, unknown>
  } = {}

  if ('pinned_version' in value) {
    if (value.pinned_version !== null && typeof value.pinned_version !== 'string') {
      throw new Error('invalid prime module patch: pinned_version must be a string or null')
    }
    patch.pinned_version = value.pinned_version
  }

  if ('enabled' in value) {
    if (typeof value.enabled !== 'boolean') {
      throw new Error('invalid prime module patch: enabled must be a boolean')
    }
    patch.enabled = value.enabled
  }

  if ('rollout_mode' in value) {
    if (value.rollout_mode !== 'active' && value.rollout_mode !== 'shadow') {
      throw new Error('invalid prime module patch: rollout_mode must be active or shadow')
    }
    patch.rollout_mode = value.rollout_mode
  }

  if ('config' in value) {
    if (!isRecord(value.config)) {
      throw new Error('invalid prime module patch: config must be an object')
    }
    patch.config = value.config
  }

  return patch
}

function validatePrimeEvent(value: unknown): PrimeEvent {
  if (!isRecord(value) || typeof value.type !== 'string' || !isRecord(value.payload)) {
    throw new Error('invalid prime event: type and payload are required')
  }

  switch (value.type) {
    case 'prime.message':
      if (
        typeof value.payload.thread_id !== 'string' ||
        typeof value.payload.message_id !== 'string' ||
        typeof value.payload.content !== 'string' ||
        typeof value.payload.sender !== 'string'
      ) {
        throw new Error('invalid prime event: prime.message payload is malformed')
      }
      return {
        type: 'prime.message',
        payload: {
          thread_id: value.payload.thread_id,
          message_id: value.payload.message_id,
          content: value.payload.content,
          sender: value.payload.sender,
        },
      }
    case 'cron.fast':
      if (typeof value.payload.triggered_at !== 'string') {
        throw new Error('invalid prime event: cron.fast payload is malformed')
      }
      return {
        type: 'cron.fast',
        payload: {
          triggered_at: value.payload.triggered_at,
          source: typeof value.payload.source === 'string' ? value.payload.source : undefined,
        },
      }
    case 'fleet.delegation.completed':
      if (typeof value.payload.delegation_id !== 'string') {
        throw new Error('invalid prime event: fleet.delegation.completed payload is malformed')
      }
      return {
        type: 'fleet.delegation.completed',
        payload: {
          delegation_id: value.payload.delegation_id,
          work_item_id: typeof value.payload.work_item_id === 'string' ? value.payload.work_item_id : undefined,
          agent_id: typeof value.payload.agent_id === 'string' ? value.payload.agent_id : undefined,
          result: isRecord(value.payload.result) ? value.payload.result : undefined,
        },
      }
    case 'fleet.delegation.failed':
      if (
        typeof value.payload.delegation_id !== 'string' ||
        typeof value.payload.error !== 'string'
      ) {
        throw new Error('invalid prime event: fleet.delegation.failed payload is malformed')
      }
      return {
        type: 'fleet.delegation.failed',
        payload: {
          delegation_id: value.payload.delegation_id,
          work_item_id: typeof value.payload.work_item_id === 'string' ? value.payload.work_item_id : undefined,
          agent_id: typeof value.payload.agent_id === 'string' ? value.payload.agent_id : undefined,
          error: value.payload.error,
        },
      }
    default:
      throw new Error(`invalid prime event: unsupported type ${value.type}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`invalid prime config patch: ${field} must be a finite number`)
  }
  return value
}
