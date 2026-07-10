import { afterEach, describe, expect, it } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createAdminAuthMiddleware, createAuthRouter, sessionValueFor } from '../src/auth.js'

const TOKEN = 'test-admin-token-1234'

function buildApp(): express.Express {
  const app = express()
  app.use(express.json())
  app.get('/health', (_req, res) => res.json({ status: 'ok' }))
  app.use('/api/auth', createAuthRouter())
  app.use(createAdminAuthMiddleware())
  app.get('/api/protected', (_req, res) => res.json({ secret: true }))
  app.get('/events', (_req, res) => res.json([]))
  app.get('/assets/app.js', (_req, res) => res.send('// js'))
  return app
}

describe('admin auth', () => {
  afterEach(() => {
    delete process.env.PRIMELOOP_ADMIN_TOKEN
  })

  it('leaves everything open when no token is configured', async () => {
    const app = buildApp()
    await request(app).get('/api/protected').expect(200)
    const status = await request(app).get('/api/auth/status').expect(200)
    expect(status.body).toEqual({ required: false, authenticated: true })
  })

  describe('with a configured token', () => {
    it('rejects unauthenticated data requests but leaves health and assets open', async () => {
      process.env.PRIMELOOP_ADMIN_TOKEN = TOKEN
      const app = buildApp()
      await request(app).get('/api/protected').expect(401)
      await request(app).get('/events').expect(401)
      await request(app).get('/health').expect(200)
      await request(app).get('/assets/app.js').expect(200)
    })

    it('accepts a Bearer token', async () => {
      process.env.PRIMELOOP_ADMIN_TOKEN = TOKEN
      const app = buildApp()
      await request(app).get('/api/protected').set('Authorization', `Bearer ${TOKEN}`).expect(200)
      await request(app).get('/api/protected').set('Authorization', 'Bearer wrong').expect(401)
    })

    it('logs in with the token and authenticates via the session cookie', async () => {
      process.env.PRIMELOOP_ADMIN_TOKEN = TOKEN
      const app = buildApp()

      await request(app).post('/api/auth/login').send({ token: 'wrong' }).expect(401)

      const login = await request(app).post('/api/auth/login').send({ token: TOKEN }).expect(200)
      const cookie = login.headers['set-cookie']?.[0]
      expect(cookie).toContain('primeloop_auth=')
      expect(cookie).toContain('HttpOnly')

      await request(app).get('/api/protected').set('Cookie', cookie!.split(';')[0]).expect(200)
      const status = await request(app).get('/api/auth/status').set('Cookie', cookie!.split(';')[0]).expect(200)
      expect(status.body).toEqual({ required: true, authenticated: true })
    })

    it('does not accept the raw token as a cookie value', async () => {
      process.env.PRIMELOOP_ADMIN_TOKEN = TOKEN
      const app = buildApp()
      await request(app).get('/api/protected').set('Cookie', `primeloop_auth=${TOKEN}`).expect(401)
      await request(app).get('/api/protected').set('Cookie', `primeloop_auth=${sessionValueFor(TOKEN)}`).expect(200)
    })
  })
})
