import { Router } from 'express'
import type pg from 'pg'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { encrypt } from '../crypto.js'
import { appendThreadMessage, createThread } from '../runtime.js'
import { ensureWorkspaceScaffold, updateWorkspaceConfig } from '../workspace.js'

export function createSetupRouter({ pool }: { pool: pg.Pool }) {
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
        if (!apiKey && type !== 'litellm' && type !== 'llm') {
          clearTimeout(timeout)
          return res.status(400).json({ error: 'api_key is required for model discovery' })
        }
        upstream = await fetch(`${baseUrl}/models`, {
          signal: controller.signal,
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        })
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
      persona?: { name: string; focus: string; tone: string; instructions?: string }
      rules?: { presets: string[]; custom: string }
      cost_controls?: { monthly_token_budget: number }
      workspace?: { mode?: 'local' | 'git'; root_path?: string; remote_url?: string; branch?: string }
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
      const workspace = body.workspace ?? {}

      await updateWorkspaceConfig(pool, {
        mode: workspace.mode === 'git' ? 'git' : 'local',
        ...(workspace.root_path ? { root_path: workspace.root_path } : {}),
        remote_url: workspace.remote_url?.trim() || null,
        branch: workspace.branch?.trim() || 'main',
      })
      const workspaceStatus = await ensureWorkspaceScaffold(pool)

      await writeWorkspaceSetupFiles(workspaceStatus.effective_root, {
        chiefName: persona.name,
        chiefFocus: persona.focus,
        chiefTone: toneLabel,
        chiefInstructions: persona.instructions?.trim() ?? '',
        policy: policyParts.join('\n').trim(),
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
          const chiefName = persona.name?.trim() || 'Prime'
          const onboardingThread = await createThread(pool, {
            title: `Getting started with ${chiefName}`,
            metadata: {
              kind: 'onboarding',
              source: 'setup-launch',
            },
          })

          await appendThreadMessage(pool, onboardingThread.id, {
            role: 'assistant',
            sender: chiefName,
            content: `I'm ${chiefName}. Your control plane is live and ready. Start by telling me the first task, repo, incident, or workflow you want me to handle, and I'll turn this room into the active coordination thread for it.`,
            metadata: {
              kind: 'greeting',
            },
          })
        }
      }

      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: (err as Error).message ?? 'internal error' })
    }
  })

  return router
}

async function writeWorkspaceSetupFiles(
  root: string,
  data: {
    chiefName: string
    chiefFocus: string
    chiefTone: string
    chiefInstructions: string
    policy: string
  }
): Promise<void> {
  const profile = [
    '# Prime Profile',
    '',
    `You are ${data.chiefName || 'Prime'}, ${data.chiefFocus || 'the coordination agent for the Agent Control Plane'}.`,
    '',
    `- Tone: ${data.chiefTone}.`,
    '- Operate as the primary user-facing coordinator.',
    '- Prefer direct, concrete progress over generic acknowledgements.',
    '- When action is required, choose the next smallest useful step.',
    data.chiefInstructions ? '' : null,
    data.chiefInstructions || null,
  ].filter(Boolean).join('\n')

  const rules = ['# Standing Rules', '', data.policy || '- Keep work moving with bounded delegation.'].join('\n')

  await fs.mkdir(path.join(root, 'agents'), { recursive: true })
  await fs.mkdir(path.join(root, 'policies'), { recursive: true })
  await fs.writeFile(path.join(root, 'agents', 'prime.md'), profile, 'utf8')
  await fs.writeFile(path.join(root, 'policies', 'standing-rules.md'), rules, 'utf8')
}
