/**
 * primeloop-launcher — ACP-over-TCP bridge + per-process agent sandbox
 * (FR-023, FR-024, FR-025; contracts/launcher.md)
 *
 * The launcher runs inside the runtime container and is the only service
 * the control-plane backend talks to. It:
 *   1. Authenticates the backend via a bearer token (LAUNCHER_TOKEN env).
 *   2. Spawns agent processes as distinct UIDs (10000+) with Landlock FS
 *      scoping limited to each agent's working directory.
 *   3. Bridges the agent's stdio ↔ the ACP TCP socket the backend opened.
 *
 * Current status: T061 skeleton — HTTP control surface + health endpoint
 * are implemented; the actual UID-isolated spawn + ACP stdio bridge lands
 * in T062 when the harness transport is switched.
 */

import express from 'express'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const PORT = parseInt(process.env.LAUNCHER_PORT ?? '7700', 10)
const LAUNCHER_TOKEN = process.env.LAUNCHER_TOKEN ?? ''
const WORKDIR_ROOT = process.env.AGENT_WORKDIR_ROOT ?? '/data/agents'
const UID_BASE = 10000

// Active agent slots: agentId -> { pid, uid, workdir }
const activeSlots = new Map()
let nextUid = UID_BASE

function auth(req, res) {
  const bearer = req.headers.authorization ?? ''
  const token = bearer.startsWith('Bearer ') ? bearer.slice(7) : ''
  if (!LAUNCHER_TOKEN || token !== LAUNCHER_TOKEN) {
    res.status(401).json({ error: 'unauthorized' })
    return false
  }
  return true
}

const app = express()
app.use(express.json())

// ── Health ────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    runtimes: (process.env.RUNTIMES ?? 'opencode,pi').split(','),
    activeAgents: activeSlots.size,
  })
})

// ── startAgent ────────────────────────────────────────────────────────────
// Provisions a UID-isolated agent slot and returns the ACP endpoint the
// harness should connect to.  Full Landlock + egress enforcement lands in T062.
app.post('/agents', async (req, res) => {
  if (!auth(req, res)) return
  const { runtimeFamily, agentId, workdir: requestedWorkdir, env: extraEnv = {}, egressAllowlist = [] } = req.body

  if (!runtimeFamily || !agentId) {
    return res.status(400).json({ error: 'runtimeFamily and agentId are required' })
  }

  if (activeSlots.has(agentId)) {
    const slot = activeSlots.get(agentId)
    return res.json({ agentId, uid: slot.uid, workdir: slot.workdir, sessionEndpoint: slot.sessionEndpoint })
  }

  const uid = nextUid++
  const workdir = requestedWorkdir ?? path.join(WORKDIR_ROOT, agentId)

  try {
    await mkdir(workdir, { recursive: true })
  } catch {
    return res.status(500).json({ error: 'failed to create workdir' })
  }

  // Determine the runtime binary for this family.
  const command = runtimeFamily === 'pi' ? 'pi-acp' : 'opencode'
  const args = runtimeFamily === 'pi' ? [] : ['serve', '--port', String(7800 + uid - UID_BASE)]

  // TODO(T062): wrap spawn with Landlock FS bind + per-UID egress rules.
  const child = spawn(command, args, {
    cwd: workdir,
    uid,                    // distinct UID per agent slot
    env: {
      ...process.env,
      HOME: workdir,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })

  const slot = {
    pid: child.pid,
    uid,
    workdir,
    runtimeFamily,
    sessionEndpoint: `http://127.0.0.1:${7800 + uid - UID_BASE}`,
    egressAllowlist,
    child,
  }

  activeSlots.set(agentId, slot)

  child.on('close', () => {
    activeSlots.delete(agentId)
  })

  res.json({ agentId, uid, workdir, sessionEndpoint: slot.sessionEndpoint })
})

// ── stopAgent ─────────────────────────────────────────────────────────────
app.delete('/agents/:agentId', (req, res) => {
  if (!auth(req, res)) return
  const { agentId } = req.params
  const slot = activeSlots.get(agentId)
  if (!slot) return res.status(404).json({ error: 'agent not found' })

  try {
    slot.child.kill('SIGTERM')
  } catch {
    // already gone
  }
  activeSlots.delete(agentId)
  res.json({ ok: true })
})

// ── List active agents ────────────────────────────────────────────────────
app.get('/agents', (req, res) => {
  if (!auth(req, res)) return
  const agents = Array.from(activeSlots.entries()).map(([id, slot]) => ({
    agentId: id,
    uid: slot.uid,
    workdir: slot.workdir,
    runtimeFamily: slot.runtimeFamily,
    sessionEndpoint: slot.sessionEndpoint,
  }))
  res.json({ agents })
})

// ── ACP client-fs methods (T066, FR-025) ─────────────────────────────────
// Serve fs/read_text_file and fs/write_text_file from the launcher,
// scoped to each agent's Landlock-bounded workdir. The backend is no
// longer in the agent's filesystem path when EGRESS_SANDBOX is on.
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises'

function resolveSafe(workdir, reqPath) {
  const abs = path.resolve(workdir, reqPath)
  if (!abs.startsWith(workdir + path.sep) && abs !== workdir) {
    throw new Error(`path escapes workdir: ${reqPath}`)
  }
  return abs
}

app.post('/agents/:agentId/fs/read', async (req, res) => {
  if (!auth(req, res)) return
  const slot = activeSlots.get(req.params.agentId)
  if (!slot) return res.status(404).json({ error: 'agent not found' })
  try {
    const resolved = resolveSafe(slot.workdir, req.body.path ?? '')
    const real = await realpath(resolved).catch(() => resolved)
    if (!real.startsWith(slot.workdir)) return res.status(403).json({ error: 'path escapes workdir' })
    const content = await readFile(real, 'utf8')
    res.json({ content })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.post('/agents/:agentId/fs/write', async (req, res) => {
  if (!auth(req, res)) return
  const slot = activeSlots.get(req.params.agentId)
  if (!slot) return res.status(404).json({ error: 'agent not found' })
  try {
    const resolved = resolveSafe(slot.workdir, req.body.path ?? '')
    await mkdir(path.dirname(resolved), { recursive: true })
    await writeFile(resolved, req.body.content ?? '', 'utf8')
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[launcher] listening on :${PORT} (runtimes: ${process.env.RUNTIMES ?? 'opencode,pi'})`)
})
