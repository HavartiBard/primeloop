import { Router } from 'express'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type pg from 'pg'
import {
  parseProfileSections,
  renderProfileSections,
  SECTION_DEFS,
  SOUL_SECTION_KEYS,
  OPERATING_SECTION_KEYS,
  type SectionKey,
  type ProfileFile,
} from '../prime-agent/profile-sections.js'
import {
  ensureWorkspaceScaffold,
  readProfileFiles,
  writeProfileFiles,
  type ProfileBundle,
} from '../workspace.js'

const FALLBACK_PROMPTS_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../prompts/agents',
)

async function loadShippedDefault(file: ProfileFile): Promise<string> {
  const name = file === 'soul' ? 'prime-soul.md' : 'prime.md'
  return fs.readFile(path.join(FALLBACK_PROMPTS_DIR, name), 'utf8')
}

async function shippedDefaultSections(file: ProfileFile): Promise<Record<string, string>> {
  const md = await loadShippedDefault(file)
  const parsed = parseProfileSections(md, file)
  return parsed.sections as Record<string, string>
}

async function materializeLegacySoulIfMissing(pool: pg.Pool): Promise<void> {
  const status = await ensureWorkspaceScaffold(pool)
  const soulPath = path.join(status.effective_root, 'agents', 'prime-soul.md')
  try {
    await fs.access(soulPath)
  } catch {
    const def = await loadShippedDefault('soul')
    await fs.mkdir(path.dirname(soulPath), { recursive: true })
    await fs.writeFile(soulPath, def, 'utf8')
  }
}

function flattenSections(bundle: ProfileBundle): Record<SectionKey, string> {
  const out: Partial<Record<SectionKey, string>> = {}
  for (const key of SOUL_SECTION_KEYS) out[key] = bundle.soul.sections[key] ?? ''
  for (const key of OPERATING_SECTION_KEYS) out[key] = bundle.operating.sections[key] ?? ''
  return out as Record<SectionKey, string>
}

async function getProfileName(pool: pg.Pool): Promise<string> {
  const { rows } = await pool.query("SELECT name FROM chief_profiles WHERE id = 'default'")
  return rows[0]?.name?.trim() || 'Prime'
}

async function shapedProfileResponse(pool: pg.Pool): Promise<Record<string, unknown>> {
  await materializeLegacySoulIfMissing(pool)
  const bundle = await readProfileFiles(pool)
  const flat = flattenSections(bundle)

  const defaults_match: Partial<Record<SectionKey, boolean>> = {}
  const soulDefaults      = await shippedDefaultSections('soul')
  const operatingDefaults = await shippedDefaultSections('operating')
  const merged: Record<string, string> = { ...soulDefaults, ...operatingDefaults }
  for (const key of [...SOUL_SECTION_KEYS, ...OPERATING_SECTION_KEYS]) {
    defaults_match[key as SectionKey] = (flat[key as SectionKey] ?? '').trim() === (merged[key] ?? '').trim()
  }

  return {
    name: await getProfileName(pool),
    soul: {
      identity:       flat.identity ?? '',
      voice_tone:     flat.voice_tone ?? '',
      decision_style: flat.decision_style ?? '',
    },
    operating: {
      default_behaviors:   flat.default_behaviors ?? '',
      approval_thresholds: flat.approval_thresholds ?? '',
    },
    defaults_match,
    shipped_defaults: {
      identity:            merged.identity            ?? '',
      voice_tone:          merged.voice_tone          ?? '',
      decision_style:      merged.decision_style      ?? '',
      default_behaviors:   merged.default_behaviors   ?? '',
      approval_thresholds: merged.approval_thresholds ?? '',
    },
  }
}

function isSectionKey(value: unknown): value is SectionKey {
  return typeof value === 'string' && value in SECTION_DEFS
}

export function createPrimeProfileRouter({ pool }: { pool: pg.Pool }) {
  const router = Router()

  router.get('/', async (_req, res) => {
    try {
      res.json(await shapedProfileResponse(pool))
    } catch (err) {
      res.status(500).json({ error: (err as Error).message ?? 'internal error' })
    }
  })

  router.put('/', async (req, res) => {
    const body = req.body as {
      name?: string
      soul?: { identity?: string; voice_tone?: string; decision_style?: string }
      operating?: { default_behaviors?: string; approval_thresholds?: string }
    }
    try {
      await materializeLegacySoulIfMissing(pool)
      const current = await readProfileFiles(pool)
      if (body.soul) {
        current.soul.sections = {
          identity:       body.soul.identity       ?? current.soul.sections.identity       ?? '',
          voice_tone:     body.soul.voice_tone     ?? current.soul.sections.voice_tone     ?? '',
          decision_style: body.soul.decision_style ?? current.soul.sections.decision_style ?? '',
        }
      }
      if (body.operating) {
        current.operating.sections = {
          default_behaviors:   body.operating.default_behaviors   ?? current.operating.sections.default_behaviors   ?? '',
          approval_thresholds: body.operating.approval_thresholds ?? current.operating.sections.approval_thresholds ?? '',
        }
      }
      await writeProfileFiles(pool, current)
      if (typeof body.name === 'string' && body.name.trim()) {
        await pool.query(
          `UPDATE chief_profiles SET name = $1, updated_at = now() WHERE id = 'default'`,
          [body.name.trim()],
        )
      }
      res.json(await shapedProfileResponse(pool))
    } catch (err) {
      res.status(500).json({ error: (err as Error).message ?? 'internal error' })
    }
  })

  router.patch('/sections/:key', async (req, res) => {
    const key = req.params.key
    if (!isSectionKey(key)) {
      return res.status(400).json({ error: `unknown section key: ${key}` })
    }
    const newText = (req.body as { new_text?: string })?.new_text
    if (typeof newText !== 'string') {
      return res.status(400).json({ error: 'new_text required' })
    }
    try {
      await materializeLegacySoulIfMissing(pool)
      const current = await readProfileFiles(pool)
      const file = SECTION_DEFS[key].file
      current[file].sections[key] = newText
      await writeProfileFiles(pool, current)
      res.json(await shapedProfileResponse(pool))
    } catch (err) {
      res.status(500).json({ error: (err as Error).message ?? 'internal error' })
    }
  })

  return router
}
