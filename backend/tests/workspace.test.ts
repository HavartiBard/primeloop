import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { createPool, runMigrations } from '../src/db.js'
import { ensureWorkspaceScaffold, loadPrimeWorkspaceTemplates } from '../src/workspace.js'

const TEST_DB = process.env.TEST_DATABASE_URL!
process.env.SECRET_ENCRYPTION_KEY = 'a'.repeat(64)

describe('workspace prime-soul template', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    await ensureWorkspaceScaffold(pool)
  })

  afterAll(async () => {
    await pool.end()
  })

  it('scaffolds prime-soul.md from the shipped default', async () => {
    const bundle = await loadPrimeWorkspaceTemplates(pool)
    expect(bundle.templates.primeSoul).toBeDefined()
    expect(bundle.templates.primeSoul.length).toBeGreaterThan(100)
    expect(bundle.templates.primeSoul).toContain('## Identity')
    expect(bundle.templatePaths.primeSoul).toBe('agents/prime-soul.md')
  })
})
