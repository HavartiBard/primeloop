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

const deviceSessions = new Map<string, DeviceSession>()

function runCodex(args: string[], stdinData?: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('codex', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (d: Buffer) => { output += d.toString() })
    child.stderr.on('data', (d: Buffer) => { output += d.toString() })
    child.on('close', (code) => resolve({ code, output }))
    if (stdinData != null) {
      child.stdin.write(stdinData)
      child.stdin.end()
    }
  })
}

export function createCodexAuthRouter() {
  const router = Router({ mergeParams: true })

  router.get('/', async (_req, res) => {
    try {
      const { output } = await runCodex(['login', 'status'])
      const text = output.toLowerCase()
      const notLoggedIn = text.includes('not logged') || text.includes('not authenticated')

      if (text.includes('chatgpt')) {
        const email = output.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i)?.[0] ?? null
        res.json({ status: 'chatgpt', mode: 'chatgpt', email, raw: output.trim() })
      } else if (!notLoggedIn && (text.includes('logged in') || text.includes('api key'))) {
        res.json({ status: 'api_key', mode: 'api_key', email: null, raw: output.trim() })
      } else {
        res.json({ status: 'unauthenticated', mode: null, email: null, raw: output.trim() })
      }
    } catch {
      res.status(500).json({ error: 'failed to check auth status' })
    }
  })

  router.post('/device', (_req, res) => {
    const sessionId = crypto.randomUUID()
    const session: DeviceSession = { status: 'pending' }
    deviceSessions.set(sessionId, session)

    const child = spawn('codex', ['login', '--device-auth'], { stdio: ['ignore', 'pipe', 'pipe'] })
    session.child = child

    let output = ''
    let responded = false

    child.stdout.on('data', (d: Buffer) => { output += d.toString() })
    child.stderr.on('data', (d: Buffer) => { output += d.toString() })

    const collectTimer = setTimeout(() => {
      if (responded) return
      responded = true
      const clean = stripAnsi(output)
      const urlMatch = clean.match(/https?:\/\/[^\s\]]+/)
      if (!urlMatch) {
        res.status(500).json({ error: 'no auth URL produced', raw: clean.trim() })
        return
      }
      const url = urlMatch[0].replace(/[.,;!]$/, '')
      const codeMatch = clean.match(/\b([A-Z0-9]{4,}-[A-Z0-9]{4,})\b/)
      const code = codeMatch?.[1] ?? null
      session.url = url
      session.code = code
      res.json({ session_id: sessionId, url, code })
    }, 4_000)

    child.on('close', (code) => {
      clearTimeout(collectTimer)
      session.status = code === 0 ? 'complete' : 'error'
      if (code !== 0) session.error = `exited ${code}`
      if (!responded) {
        responded = true
        const clean = stripAnsi(output)
        res.status(500).json({ error: 'no auth URL produced', raw: clean.trim() })
      }
    })

    const killTimeout = setTimeout(() => {
      if (session.status === 'pending') {
        child.kill()
        session.status = 'error'
        session.error = 'timeout'
      }
    }, 600_000)
    child.on('close', () => clearTimeout(killTimeout))
  })

  router.get('/device/:sessionId', (req, res) => {
    const session = deviceSessions.get(req.params.sessionId)
    if (!session) return res.status(404).json({ error: 'session not found' })
    res.json({ status: session.status, url: session.url, code: session.code, error: session.error })
  })

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
