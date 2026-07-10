/**
 * Admin access gate for the dashboard and API.
 *
 * When PRIMELOOP_ADMIN_TOKEN is set (install.sh generates one), every data
 * route requires either:
 *   - `Authorization: Bearer <token>`  (scripts, curl, CI), or
 *   - the session cookie set by POST /api/auth/login  (the dashboard).
 *
 * The cookie stores an HMAC derived from the token — never the token itself —
 * so a leaked cookie can't be replayed as the Bearer credential.
 *
 * Left open: /health, /api/auth/*, static assets (the dashboard shell renders
 * a login screen), and /internal/llm/* which has its own per-agent tokens.
 */
import crypto from 'node:crypto'
import express from 'express'

const COOKIE_NAME = 'primeloop_auth'
const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60 // 30 days

const PROTECTED_PREFIXES = ['/api', '/events', '/agents']

export function configuredAdminToken(env: NodeJS.ProcessEnv = process.env): string {
  return env.PRIMELOOP_ADMIN_TOKEN?.trim() ?? ''
}

export function sessionValueFor(token: string): string {
  return crypto.createHmac('sha256', token).update('primeloop-session-v1').digest('hex')
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return undefined
}

// Structural type so this also works for raw WebSocket upgrade requests.
interface HasAuthHeaders {
  headers: { authorization?: string; cookie?: string }
}

export function isAuthenticatedRequest(req: HasAuthHeaders, token: string): boolean {
  const auth = req.headers.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ') && timingSafeEqual(auth.slice(7), token)) {
    return true
  }
  const cookie = parseCookie(req.headers.cookie, COOKIE_NAME)
  return Boolean(cookie && timingSafeEqual(cookie, sessionValueFor(token)))
}

export function createAdminAuthMiddleware(): express.RequestHandler {
  return (req, res, next) => {
    const token = configuredAdminToken()
    if (!token) return next()

    const path = req.path
    if (path === '/health' || path.startsWith('/api/auth') || path.startsWith('/internal/llm')) {
      return next()
    }
    if (!PROTECTED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      return next() // static assets and the SPA shell
    }
    if (isAuthenticatedRequest(req, token)) return next()

    res.status(401).json({ error: 'authentication required' })
  }
}

export function createAuthRouter(): express.Router {
  const router = express.Router()

  router.get('/status', (req, res) => {
    const token = configuredAdminToken()
    res.json({
      required: Boolean(token),
      authenticated: !token || isAuthenticatedRequest(req, token),
    })
  })

  router.post('/login', (req, res) => {
    const token = configuredAdminToken()
    if (!token) return res.json({ ok: true })

    const provided = (req.body as { token?: string } | undefined)?.token
    if (typeof provided !== 'string' || !timingSafeEqual(provided.trim(), token)) {
      return res.status(401).json({ error: 'invalid token' })
    }
    res.cookie(COOKIE_NAME, sessionValueFor(token), {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE_S * 1000,
      path: '/',
    })
    res.json({ ok: true })
  })

  router.post('/logout', (_req, res) => {
    res.clearCookie(COOKIE_NAME, { path: '/' })
    res.json({ ok: true })
  })

  return router
}
