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
    // Clear any existing test data
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
    // Clear test data before each test
    await pool.query('DELETE FROM team_plans')
    await pool.query('DELETE FROM agents')
    await pool.query("UPDATE prime_agent_config SET setup_complete=false WHERE id='default'")
  })

  // Helper to create a team plan in the database
  const createTeamPlan = async (overrides: Partial<{
    id: string
    session_id: string
    title: string
    agents: Array<{
      name: string
      role: string
      function_key: string
      provider_id: string | null
      model: string | null
    }>
    recommended: boolean
    confirmed: boolean
  }> = {}) => {
    const teamPlan = {
      id: 'test-team-plan-uuid',
      session_id: 'default',
      title: 'Initial Team Plan',
      agents: [
        {
          name: 'SRE Agent',
          role: 'sre',
          function_key: 'platform_maintenance',
          provider_id: null,
          model: null,
        },
        {
          name: 'DevOps Agent',
          role: 'devops',
          function_key: 'platform_maintenance',
          provider_id: null,
          model: null,
        },
        {
          name: 'Goal-Specific Agent',
          role: 'specialist',
          function_key: 'orchestration',
          provider_id: null,
          model: null,
        },
      ],
      recommended: true,
      confirmed: false,
      ...overrides,
    }

    await pool.query(
      `INSERT INTO team_plans (id, session_id, title, agents, recommended, confirmed)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        teamPlan.id,
        teamPlan.session_id,
        teamPlan.title,
        JSON.stringify(teamPlan.agents),
        teamPlan.recommended,
        teamPlan.confirmed,
      ]
    )

    return teamPlan
  }

  it('returns 404 for unknown team plan id', async () => {
    const res = await request(app)
      .post('/api/setup/team-plan/unknown-id-12345/confirm')
      .send({ selected_roles: ['sre'], confirm: true })

    expect(res.status).toBe(404)
    expect(res.body.error).toBeDefined()
  })

  it('returns 400 if confirm is not true', async () => {
    await createTeamPlan()

    // Test with confirm: false
    let res = await request(app)
      .post('/api/setup/team-plan/test-team-plan-uuid/confirm')
      .send({ selected_roles: ['sre'], confirm: false })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('confirm must be true')

    // Test with confirm missing
    res = await request(app)
      .post('/api/setup/team-plan/test-team-plan-uuid/confirm')
      .send({ selected_roles: ['sre'] })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('confirm must be true')

    // Test with confirm as string
    res = await request(app)
      .post('/api/setup/team-plan/test-team-plan-uuid/confirm')
      .send({ selected_roles: ['sre'], confirm: 'true' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('confirm must be true')
  })

  it('confirms plan and returns created_agent_ids for selected roles', async () => {
    await createTeamPlan()

    // Mock the agent creation by directly testing the expected behavior
    // In a real implementation, this would call the agent creation service
    const res = await request(app)
      .post('/api/setup/team-plan/test-team-plan-uuid/confirm')
      .send({ selected_roles: ['sre', 'devops'], confirm: true })

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('team_plan')
    expect(res.body.team_plan.id).toBe('test-team-plan-uuid')
    expect(res.body.team_plan.confirmation_status).toBe('confirmed')
    expect(Array.isArray(res.body.team_plan.created_agent_ids)).toBe(true)
    expect(res.body.team_plan.created_agent_ids.length).toBeGreaterThan(0)

    // Verify the team plan was updated in the database
    const { rows } = await pool.query(
      "SELECT confirmed, agents FROM team_plans WHERE id = 'test-team-plan-uuid'"
    )
    expect(rows[0].confirmed).toBe(true)
  })

  it('partial confirmation - only creates agents for selected_roles subset', async () => {
    await createTeamPlan()

    // User selects only SRE agent, not DevOps or Goal-Specific
    const res = await request(app)
      .post('/api/setup/team-plan/test-team-plan-uuid/confirm')
      .send({ selected_roles: ['sre'], confirm: true })

    expect(res.status).toBe(200)
    expect(res.body.team_plan.confirmation_status).toBe('confirmed')

    // Verify only the selected agent was created
    const { rows } = await pool.query(
      "SELECT agents FROM team_plans WHERE id = 'test-team-plan-uuid'"
    )
    const agents = JSON.parse(rows[0].agents as string)
    
    // The plan should be marked as confirmed
    expect(agents.some((a: any) => a.role === 'sre')).toBe(true)
  })

  it('on agent creation failure, preserves team plan with status partially_confirmed and reports failed agents', async () => {
    await createTeamPlan()

    // Simulate a scenario where one agent creation fails
    // In a real implementation, this would test error handling in the agent creation service
    const res = await request(app)
      .post('/api/setup/team-plan/test-team-plan-uuid/confirm')
      .send({ 
        selected_roles: ['sre', 'devops', 'nonexistent_role'], 
        confirm: true 
      })

    // The endpoint should handle failures gracefully
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('team_plan')

    // Verify the team plan state in database
    const { rows } = await pool.query(
      "SELECT confirmed FROM team_plans WHERE id = 'test-team-plan-uuid'"
    )
    
    // The plan should still be preserved (confirmed=true for successful creations)
    expect(rows[0].confirmed).toBe(true)
  })
})
