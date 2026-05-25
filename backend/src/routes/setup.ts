import { Router } from 'express'
import type pg from 'pg'
import { encrypt } from '../crypto.js'
import { appendThreadMessage, computeSynopsisInput, createThread } from '../runtime.js'
import {
  ensureWorkspaceScaffold,
  readProfileFiles,
  writeProfileFiles,
  updateWorkspaceConfig,
} from '../workspace.js'
import { buildProfileSynopsis } from '../prime-agent/profile-synopsis.js'
import type { SoulSectionKey, OperatingSectionKey } from '../prime-agent/profile-sections.js'

export function createSetupRouter({
  pool,
  onSetupCompleted,
}: {
  pool: pg.Pool
  onSetupCompleted?: () => Promise<void> | void
}) {
  const router = Router()

  router.get('/status', async (_req, res) => {
    try {
      const { rows: providerRows } = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM providers
         WHERE NOT (type = 'codex' AND name = 'Codex (local)')`
      )
      if (providerRows[0].count > 0) {
        return res.json({ complete: true })
      }
      const { rows } = await pool.query(
        "SELECT setup_complete FROM prime_agent_config WHERE id = 'default'"
      )
      res.json({ complete: rows[0]?.setup_complete ?? false })
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/ollama-models', async (req, res) => {
    const base_url = req.query.base_url as string | undefined
    if (!base_url) {
      return res.status(400).json({ error: 'base_url query param required' })
    }
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3_000)
      const upstream = await fetch(`${base_url}/api/tags`, { signal: controller.signal })
      clearTimeout(timeout)
      const data = await upstream.json()
      res.json(data)
    } catch {
      res.json({ error: 'unreachable' })
    }
  })

  router.post('/provider-models', async (req, res) => {
    const body = req.body as { type?: string; base_url?: string; api_key?: string }
    const type = body.type?.trim()
    const baseUrl = body.base_url?.trim().replace(/\/+$/, '')
    const apiKey = body.api_key?.trim()

    if (!type || !baseUrl) {
      return res.status(400).json({ error: 'type and base_url are required' })
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5_000)
      let upstream: Response

      if (type === 'ollama') {
        upstream = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal })
        clearTimeout(timeout)
        const data = await upstream.json() as { models?: Array<{ name?: string }> }
        const models = (data.models ?? []).map((m) => m.name).filter(Boolean)
        return res.json({ models })
      }

      if (type === 'anthropic') {
        if (!apiKey) {
          clearTimeout(timeout)
          return res.status(400).json({ error: 'api_key is required for anthropic model discovery' })
        }
        upstream = await fetch(`${baseUrl}/v1/models`, {
          signal: controller.signal,
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
        })
      } else {
        if (apiKey) {
          upstream = await fetch(`${baseUrl}/models`, {
            signal: controller.signal,
            headers: { Authorization: `Bearer ${apiKey}` },
          })
        } else if (type === 'litellm' || type === 'llm') {
          upstream = await fetch(`${baseUrl}/models`, { signal: controller.signal })
        } else {
          // No API key for OpenAI-compatible provider (e.g. subscription/device auth flow).
          // Return sensible defaults so the UI can still populate model dropdowns.
          clearTimeout(timeout)
          return res.json({ models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o3', 'o3-mini', 'o4-mini'] })
        }
      }

      clearTimeout(timeout)
      if (!upstream.ok) {
        return res.status(upstream.status).json({ error: 'provider rejected model discovery request' })
      }

      const data = await upstream.json() as { data?: Array<{ id?: string }> }
      const models = (data.data ?? []).map((m) => m.id).filter(Boolean).sort()
      res.json({ models })
    } catch {
      res.json({ error: 'unreachable', models: [] })
    }
  })

  const PRESET_LABELS: Record<string, string> = {
    test_before_delegate: 'Always run tests before delegating work to agents',
    no_force_push: 'Never force-push to main or protected branches',
    small_prs: 'Prefer small, reviewable pull requests over large ones',
    confirm_destructive: 'Ask before taking destructive or irreversible actions',
    humans_in_loop: 'Keep humans in the loop on external communications',
  }

  router.post('/complete', async (req, res) => {
    const body = req.body as {
      providers?: Array<{ id?: string; name: string; type: string; base_url: string; api_key?: string; model?: string }>
      routing?: Record<string, Array<{ provider_name: string; model: string }>>
      profile?: {
        name?: string
        soul?: { identity?: string; voice_tone?: string; decision_style?: string }
        operating?: { default_behaviors?: string; approval_thresholds?: string }
      }
      persona?: { name: string; focus: string; tone: string; instructions?: string }
      rules?: { presets: string[]; custom: string }
      cost_controls?: { monthly_token_budget: number }
      workspace?: { mode?: 'local' | 'git'; root_path?: string; remote_url?: string; branch?: string }
      launch?: boolean
    }

    if (!Array.isArray(body?.providers) || !body?.routing || !body?.rules || (!body.profile && !body.persona)) {
      return res.status(400).json({ error: 'providers, routing, rules, and (profile or persona) are required' })
    }

    try {
      const providerNameToId = new Map<string, string>()

      for (const p of body.providers) {
        if (p.id) {
          providerNameToId.set(p.name, p.id)
          continue
        }

        const { rows: existing } = await pool.query(
          'SELECT id FROM providers WHERE name = $1',
          [p.name]
        )

        if (existing.length > 0) {
          const encKey = p.api_key ? encrypt(p.api_key) : undefined
          if (encKey) {
            await pool.query(
              'UPDATE providers SET type=$2, base_url=$3, model=$4, api_key=$5 WHERE id=$1',
              [existing[0].id, p.type, p.base_url, p.model ?? null, encKey]
            )
          } else {
            await pool.query(
              'UPDATE providers SET type=$2, base_url=$3, model=$4 WHERE id=$1',
              [existing[0].id, p.type, p.base_url, p.model ?? null]
            )
          }
          providerNameToId.set(p.name, existing[0].id)
        } else {
          const encKey = p.api_key ? encrypt(p.api_key) : null
          const { rows: inserted } = await pool.query(
            'INSERT INTO providers (name, type, base_url, api_key, model) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [p.name, p.type, p.base_url, encKey, p.model ?? null]
          )
          providerNameToId.set(p.name, inserted[0].id)
        }
      }

      const routing: Record<string, Array<{ provider_id: string; model: string }>> = {}
      for (const [routeName, routes] of Object.entries(body.routing)) {
        const resolved = (routes ?? [])
          .filter((r) => r.provider_name && providerNameToId.has(r.provider_name))
          .map((r) => ({ provider_id: providerNameToId.get(r.provider_name)!, model: r.model }))
        if (resolved.length > 0) routing[routeName] = resolved
      }

      // --- profile block (structured or legacy persona) ---
      const name = body.profile?.name?.trim() || body.persona?.name?.trim() || 'Prime'

      let soulSections: Record<SoulSectionKey, string>
      let operatingSections: Record<OperatingSectionKey, string>

      if (body.profile) {
        soulSections = {
          identity:       body.profile.soul?.identity       ?? '',
          voice_tone:     body.profile.soul?.voice_tone     ?? '',
          decision_style: body.profile.soul?.decision_style ?? '',
        }
        operatingSections = {
          default_behaviors:   body.profile.operating?.default_behaviors   ?? '',
          approval_thresholds: body.profile.operating?.approval_thresholds ?? '',
        }
      } else {
        const p = body.persona!
        const toneLabel =
          p.tone === 'direct' ? 'Direct & concise.'
          : p.tone === 'thorough' ? 'Thorough & deliberate.'
          : 'Collaborative & inquisitive.'
        soulSections = {
          identity:       `You are ${name}, ${p.focus || 'the coordination agent'}.`,
          voice_tone:     toneLabel,
          decision_style: (p.instructions ?? '').trim() || 'Smallest useful next step wins.',
        }
        operatingSections = { default_behaviors: '', approval_thresholds: '' }
      }

      await ensureWorkspaceScaffold(pool)

      // Seed chief_profiles row if missing; writeProfileFiles overwrites it immediately after.
      await pool.query(
        `INSERT INTO chief_profiles (id, name, persona, operating_policy)
         VALUES ('default', $1, '', '')
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
        [name],
      )

      // Read existing so unknown sections are preserved across legacy → structured upgrade
      const current = await readProfileFiles(pool)
      current.soul.sections = soulSections
      if (body.profile) {
        current.operating.sections = operatingSections
      }
      await writeProfileFiles(pool, current)

      // --- standing rules ---
      const rules = body.rules
      const presetLines = rules.presets.map((k) => PRESET_LABELS[k]).filter(Boolean)
      const policyParts = [...presetLines]
      if (rules.custom?.trim()) policyParts.push('', rules.custom.trim())

      await pool.query(
        `UPDATE chief_profiles SET operating_policy = $1, updated_at = now() WHERE id = 'default'`,
        [policyParts.join('\n')],
      )

      // --- cost controls + workspace + launch ---
      const costControls = body.cost_controls ?? { monthly_token_budget: 0 }
      const launch = body.launch === true
      const workspace = body.workspace ?? {}

      await updateWorkspaceConfig(pool, {
        mode: workspace.mode === 'git' ? 'git' : 'local',
        ...(workspace.root_path ? { root_path: workspace.root_path } : {}),
        remote_url: workspace.remote_url?.trim() || null,
        branch: workspace.branch?.trim() || 'main',
      })

      await pool.query(
        `UPDATE prime_agent_config
         SET provider_routing=$1, cost_controls=$2, enabled=$3, setup_complete=true
         WHERE id='default'`,
        [JSON.stringify(routing), JSON.stringify(costControls), launch]
      )

      if (launch) {
        const { rows: threadRows } = await pool.query(
          'SELECT COUNT(*)::int AS count FROM threads'
        )

        if (threadRows[0]?.count === 0) {
          const primeName = name
          const synopsis = buildProfileSynopsis(await computeSynopsisInput(pool))
          const onboardingThread = await createThread(pool, {
            title: `Getting started with ${primeName}`,
            metadata: {
              kind: 'onboarding',
              source: 'setup-launch',
            },
          })

          await appendThreadMessage(pool, onboardingThread.id, {
            role: 'assistant',
            sender: primeName,
            content: `I'm ${primeName}. ${synopsis}`,
            metadata: {
              kind: 'greeting',
            },
          })
        }
      }

      await onSetupCompleted?.()

      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: (err as Error).message ?? 'internal error' })
    }
  })

  return router
}
