import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import pg from 'pg'
import { createPool, runMigrations } from '../src/db.js'
import { createSetupRouter } from '../src/routes/setup.js'

const TEST_DB = process.env.TEST_DATABASE_URL!
process.env.SECRET_ENCRYPTION_KEY = 'a'.repeat(64)

describe('POST /api/setup/team-plan/:id/confirm', () => {
  let pool: pg.Pool
  let app: express.Application

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    await pool.query('DELETE FROM team_plans')
    await pool.query('DELETE FROM agents')
    await pool.query("UPDATE prime_agent_config SET setup_complete=false WHERE id='default'")
    app = express()
    app.use(express.json())
    app.use('/api/setup', createSetupRouter({ pool }))
  })

  afterAll(async () => {
    await pool.query('DELETE FROM team_plans')
    await pool.query('DELETE FROM agents')
    await pool.query("UPDATE prime_agent_config SET setup_complete=false WHERE id='default'")
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM team_plans')
    await pool.query('DELETE FROM agents')
    await pool.query("UPDATE prime_agent_config SET setup_complete=false WHERE id='default'")
  })

  const createTeamPlan = async () => {
    await pool.query(
      `INSERT INTO onboarding_session (id, current_step, status)
       VALUES ('default', 'plugins', 'in_progress')
       ON CONFLICT (id) DO NOTHING`
    )
    const { rows } = await pool.query<{ id: string }>('SELECT gen_random_uuid()::text AS id')
    const id = rows[0].id
    const agents = [
      { name: 'SRE Agent', role: 'sre', function_key: 'platform_maintenance', provider_id: null, model: null },
      { name: 'DevOps Agent', role: 'devops', function_key: 'platform_maintenance', provider_id: null, model: null },
      { name: 'Goal-Specific Agent', role: 'specialist', function_key: 'orchestration', provider_id: null, model: null },
    ]
    await pool.query(
      `INSERT INTO team_plans (id, session_id, title, agents, recommended, confirmed)
       VALUES ($1, 'default', 'Initial Team Plan', $2, true, false)`,
      [id, JSON.stringify(agents)],
    )
    return id
  }

  it('returns 404 for unknown team plan id', async () => {
    const res = await request(app)
      .post('/api/setup/team-plan/00000000-0000-0000-0000-000000000000/confirm')
      .send({ selected_roles: ['sre'], confirm: true })

    expect(res.status).toBe(404)
  })

  it('returns 400 if confirm is not true', async () => {
    const id = await createTeamPlan()

    let res = await request(app)
      .post(`/api/setup/team-plan/${id}/confirm`)
      .send({ selected_roles: ['sre'], confirm: false })
    expect(res.status).toBe(400)

    res = await request(app)
      .post(`/api/setup/team-plan/${id}/confirm`)
      .send({ selected_roles: ['sre'] })
    expect(res.status).toBe(400)
  })

  it('confirms plan and returns created_agent_ids for selected roles', async () => {
    const id = await createTeamPlan()
    const res = await request(app)
      .post(`/api/setup/team-plan/${id}/confirm`)
      .send({ selected_roles: ['sre', 'devops'], confirm: true })

    expect(res.status).toBe(200)
    expect(res.body.team_plan.id).toBe(id)
    expect(['confirmed', 'partially_confirmed']).toContain(res.body.team_plan.confirmation_status)
    expect(Array.isArray(res.body.team_plan.created_agent_ids)).toBe(true)

    const check = await pool.query('SELECT confirmed FROM team_plans WHERE id = $1', [id])
    expect(check.rows[0].confirmed).toBe(true)
  })
})
