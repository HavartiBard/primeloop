import { Router } from 'express'
import { spawn } from 'child_process'
import crypto from 'crypto'

interface DeviceSession {
  status: 'pending' | 'complete' | 'error'
  url?: string
  code?: string | null
  error?: string
  child?: ReturnType<typeof spawn>
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[mGKHFJA-Z]/g, '')
}

function parseDeviceAuthOutput(output: string): { url?: string; code?: string | null } {
  const clean = stripAnsi(output)
  const urlMatch = clean.match(/https?:\/\/[^\s\]]+/)
  const codeMatch = clean.match(/\b([A-Z0-9]{4,}-[A-Z0-9]{4,})\b/)
  return {
    url: urlMatch?.[0]?.replace(/[.,;!]$/, ''),
    code: codeMatch?.[1] ?? null,
  }
}

function parseLoginStatus(output: string): 'chatgpt' | 'api_key' | 'unauthenticated' {
  const text = output.toLowerCase()
  const notLoggedIn = text.includes('not logged') || text.includes('not authenticated')
  if (text.includes('chatgpt')) return 'chatgpt'
  if (!notLoggedIn && (text.includes('logged in') || text.includes('api key'))) return 'api_key'
  return 'unauthenticated'
}

const deviceSessions = new Map<string, DeviceSession>()

function runCodex(args: string[], stdinData?: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('codex', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (d: Buffer) => { output += d.toString() })
    child.stderr.on('data', (d: Buffer) => { output += d.toString() })
    child.on('error', (err) => resolve({ code: null, output: String(err.message ?? err) }))
    child.on('close', (code) => resolve({ code, output }))
    if (stdinData != null) { child.stdin.write(stdinData); child.stdin.end() }
  })
}

export function createCodexAuthRouter() {
  const router = Router({ mergeParams: true })

  // GET /api/providers/:providerId/codex/auth — current auth status
  router.get('/', async (_req, res) => {
    try {
      const { output } = await runCodex(['login', 'status'])
      const status = parseLoginStatus(output)
      if (status === 'chatgpt') {
        const email = output.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i)?.[0] ?? null
        res.json({ status: 'chatgpt', mode: 'chatgpt', email, raw: output.trim() })
      } else if (status === 'api_key') {
        res.json({ status: 'api_key', mode: 'api_key', email: null, raw: output.trim() })
      } else {
        res.json({ status: 'unauthenticated', mode: null, email: null, raw: output.trim() })
      }
    } catch {
      res.status(500).json({ error: 'failed to check auth status' })
    }
  })

  // POST /api/providers/:providerId/codex/auth/device — start device auth flow
  router.post('/device', async (_req, res) => {
    const sessionId = crypto.randomUUID()
    const session: DeviceSession = { status: 'pending' }
    deviceSessions.set(sessionId, session)

    const currentStatus = await runCodex(['login', 'status'])
    if (parseLoginStatus(currentStatus.output) !== 'unauthenticated') {
      session.status = 'complete'
      return res.json({ session_id: sessionId, url: null, code: null, already_authenticated: true })
    }

    const child = spawn('codex', ['login', '--device-auth'], { stdio: ['ignore', 'pipe', 'pipe'] })
    session.child = child

    let output = ''
    let responded = false

    const maybeRespondWithDeviceCode = () => {
      if (responded) return
      const parsed = parseDeviceAuthOutput(output)
      if (!parsed.url) return
      responded = true
      session.url = parsed.url
      session.code = parsed.code
      res.json({ session_id: sessionId, url: parsed.url, code: parsed.code, already_authenticated: false })
    }

    child.stdout.on('data', (d: Buffer) => {
      output += d.toString()
      maybeRespondWithDeviceCode()
    })
    child.stderr.on('data', (d: Buffer) => {
      output += d.toString()
      maybeRespondWithDeviceCode()
    })
    child.on('error', (err) => {
      if (responded) return
      responded = true
      session.status = 'error'
      session.error = String(err.message ?? err)
      res.status(500).json({ error: session.error })
    })

    const collectTimer = setTimeout(() => {
      if (responded) return
      const parsed = parseDeviceAuthOutput(output)
      if (parsed.url) {
        responded = true
        session.url = parsed.url
        session.code = parsed.code
        res.json({ session_id: sessionId, url: parsed.url, code: parsed.code, already_authenticated: false })
        return
      }
      responded = true
      res.status(500).json({ error: 'no auth URL produced', raw: stripAnsi(output).trim() })
    }, 15_000)

    child.on('close', async (code) => {
      clearTimeout(collectTimer)
      session.status = code === 0 ? 'complete' : 'error'
      if (code !== 0) session.error = `exited ${code}`
      if (!responded) {
        const parsed = parseDeviceAuthOutput(output)
        if (parsed.url) {
          responded = true
          session.url = parsed.url
          session.code = parsed.code
          return res.json({ session_id: sessionId, url: parsed.url, code: parsed.code, already_authenticated: false })
        }
        const statusCheck = await runCodex(['login', 'status'])
        if (parseLoginStatus(statusCheck.output) !== 'unauthenticated') {
          responded = true
          session.status = 'complete'
          return res.json({ session_id: sessionId, url: null, code: null, already_authenticated: true })
        }
        responded = true
        const clean = stripAnsi(output).trim()
        res.status(500).json({ error: clean || session.error || 'no auth URL produced' })
      }
    })

    const killTimeout = setTimeout(() => {
      if (session.status === 'pending') {
        child.kill()
        session.status = 'error'
        session.error = 'timeout'
      }
    }, 600_000) // 10-minute hard kill
    child.on('close', () => clearTimeout(killTimeout))
  })

  // GET /api/providers/:providerId/codex/auth/device/:sessionId — poll status
  router.get('/device/:sessionId', (req, res) => {
    const session = deviceSessions.get(req.params.sessionId)
    if (!session) return res.status(404).json({ error: 'session not found' })
    res.json({ status: session.status, url: session.url, code: session.code, error: session.error })
  })

  // POST /api/providers/:providerId/codex/auth/apikey — authenticate with API key
  router.post('/apikey', async (req, res) => {
    const { api_key } = req.body as { api_key?: string }
    if (!api_key || typeof api_key !== 'string' || !api_key.trim()) {
      return res.status(400).json({ error: 'api_key required' })
    }
    try {
      const { code, output } = await runCodex(['login', '--with-api-key'], api_key.trim())
      if (code === 0) {
        res.json({ ok: true, raw: output.trim() })
      } else {
        res.status(400).json({ ok: false, error: output.trim() || `exited ${code}` })
      }
    } catch {
      res.status(500).json({ error: 'failed to run codex login' })
    }
  })

  // POST /api/providers/:providerId/codex/auth/logout — clear credentials
  router.post('/logout', async (_req, res) => {
    try {
      const { code, output } = await runCodex(['logout'])
      res.json({ ok: code === 0, raw: output.trim() })
    } catch {
      res.status(500).json({ error: 'failed to run codex logout' })
    }
  })

  return router
}
