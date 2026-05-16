import { Router } from 'express'
import type pg from 'pg'
import { encrypt } from '../crypto.js'

export function createSetupRouter({ pool }: { pool: pg.Pool }) {
  const router = Router()

  router.get('/status', async (_req, res) => {
    try {
      const { rows: providerRows } = await pool.query(
        'SELECT COUNT(*)::int AS count FROM providers'
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
      persona?: { name: string; focus: string; tone: string; instructions?: string }
      rules?: { presets: string[]; custom: string }
      cost_controls?: { monthly_token_budget: number }
      launch?: boolean
    }

    if (!Array.isArray(body?.providers) || !body?.routing || !body?.persona || !body?.rules) {
      return res.status(400).json({ error: 'providers, routing, persona, and rules are required' })
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

      const persona = body.persona
      const toneLabel =
        persona.tone === 'direct' ? 'Direct & concise'
        : persona.tone === 'thorough' ? 'Thorough & deliberate'
        : 'Collaborative & inquisitive'

      const personaLines = [`You are ${persona.name}, ${persona.focus}.`, `Tone: ${toneLabel}.`]
      if (persona.instructions?.trim()) personaLines.push('', persona.instructions.trim())

      const rules = body.rules
      const presetLines = rules.presets.map((k) => PRESET_LABELS[k]).filter(Boolean)
      const policyParts = [...presetLines]
      if (rules.custom?.trim()) policyParts.push('', rules.custom.trim())

      await pool.query(
        `INSERT INTO chief_profiles (id, name, persona, operating_policy)
         VALUES ('default', $1, $2, $3)
         ON CONFLICT (id) DO UPDATE
           SET name = EXCLUDED.name,
               persona = EXCLUDED.persona,
               operating_policy = EXCLUDED.operating_policy,
               updated_at = now()`,
        [persona.name, personaLines.join('\n'), policyParts.join('\n')]
      )

      const costControls = body.cost_controls ?? { monthly_token_budget: 0 }
      const launch = body.launch === true

      await pool.query(
        `UPDATE prime_agent_config
         SET provider_routing=$1, cost_controls=$2, enabled=$3, setup_complete=true
         WHERE id='default'`,
        [JSON.stringify(routing), JSON.stringify(costControls), launch]
      )

      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: (err as Error).message ?? 'internal error' })
    }
  })

  return router
}
