import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import pg from 'pg'
import { createPool, runMigrations } from '../src/db.js'
import { createProvidersRouter } from '../src/routes/providers.js'

const TEST_DB = process.env.TEST_DATABASE_URL!

describe('providers router', () => {
  let pool: pg.Pool
  let app: express.Application

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    app = express()
    app.use(express.json())
    app.use('/api/providers', createProvidersRouter({ pool }))
  })

  afterAll(async () => {
    await pool.query('DELETE FROM agents')
    await pool.query('DELETE FROM providers')
    await pool.end()
  })

  it('GET / returns empty array initially', async () => {
    const res = await request(app).get('/api/providers')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('POST / creates a provider', async () => {
    const res = await request(app).post('/api/providers').send({
      name: 'test-provider',
      type: 'openai',
      base_url: 'https://api.openai.com/v1',
      api_key: 'sk-test',
    })
    expect(res.status).toBe(201)
    expect(res.body.name).toBe('test-provider')
    expect(res.body.id).toBeTruthy()
  })

  it('POST / returns 400 when required fields missing', async () => {
    const res = await request(app).post('/api/providers').send({ name: 'x' })
    expect(res.status).toBe(400)
  })

  it('GET / returns created provider', async () => {
    const res = await request(app).get('/api/providers')
    expect(res.status).toBe(200)
    expect(res.body.length).toBeGreaterThan(0)
    expect(res.body[0].name).toBe('test-provider')
  })

  it('PUT /:id updates a provider', async () => {
    const list = await request(app).get('/api/providers')
    const id = list.body[0].id
    const res = await request(app).put(`/api/providers/${id}`).send({ base_url: 'https://updated.example.com' })
    expect(res.status).toBe(200)
    expect(res.body.base_url).toBe('https://updated.example.com')
  })

  it('DELETE /:id removes a provider', async () => {
    const list = await request(app).get('/api/providers')
    const id = list.body[0].id
    const res = await request(app).delete(`/api/providers/${id}`)
    expect(res.status).toBe(204)
    const list2 = await request(app).get('/api/providers')
    expect(list2.body).toEqual([])
  })
})
