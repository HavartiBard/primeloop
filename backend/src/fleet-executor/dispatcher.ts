import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type pg from 'pg'
import { appendThreadMessage, type Delegation } from '../runtime.js'
import type { PrimeQueue } from '../prime-agent/queue.js'
import { loadWorkspaceTemplate, renderTemplate } from '../workspace.js'
import type { AgentHarness, TaskPrompt } from './harness.js'
import { routeResult } from './result-router.js'

const execFileAsync = promisify(execFile)

export interface FleetDispatcherOptions {
  pool: pg.Pool
  primeQueue: PrimeQueue
  getHarness: (agentId: string) => AgentHarness | undefined
  pollIntervalMs?: number
}

export class FleetDispatcher {
  private readonly pool: pg.Pool
  private readonly primeQueue: PrimeQueue
  private readonly getHarness: (agentId: string) => AgentHarness | undefined
  private readonly pollIntervalMs: number
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(opts: FleetDispatcherOptions) {
    this.pool = opts.pool
    this.primeQueue = opts.primeQueue
    this.getHarness = opts.getHarness
    this.pollIntervalMs = opts.pollIntervalMs ?? 5000
  }

  start(): void {
    this.timer = setInterval(() => { void this.poll() }, this.pollIntervalMs)
  }

  async stop(): Promise<void> {
    clearInterval(this.timer)
    this.timer = undefined
  }

  private async poll(): Promise<void> {
    const { rows } = await this.pool.query<Delegation>(
      `SELECT * FROM delegations WHERE status = 'queued' ORDER BY created_at LIMIT 10`,
    )

    for (const row of rows) {
      await this.dispatch(row).catch((err: unknown) => {
        console.error('[fleet-dispatcher] dispatch error:', err)
      })
    }
  }

  private async dispatch(delegation: Delegation): Promise<void> {
    // Atomic claim — skip if another worker got there first
    const { rows: claimed } = await this.pool.query<Delegation>(
      `UPDATE delegations SET status='in_progress', updated_at=now()
       WHERE id=$1 AND status='queued' RETURNING *`,
      [delegation.id],
    )
    if (claimed.length === 0) return

    const agentId = delegation.to_agent_id
    if (!agentId) {
      await routeResult(
        { pool: this.pool, primeQueue: this.primeQueue },
        delegation,
        { success: false, error: 'no target agent assigned to delegation' },
      )
      return
    }

    const harness = this.getHarness(agentId)
    if (!harness) {
      // requeue — harness not running yet
      await this.pool.query(
        `UPDATE delegations SET status='queued', updated_at=now() WHERE id=$1`,
        [delegation.id],
      )
      return
    }

    const prompt = await buildPrompt(this.pool, delegation)
    const threadId = typeof delegation.request['thread_id'] === 'string'
      ? delegation.request['thread_id']
      : undefined

    try {
      const handle = await harness.dispatch(prompt)

      // Stream progress to thread
      const progressDone = (async () => {
        for await (const event of handle.events) {
          if (event.type === 'progress' && threadId) {
            await appendThreadMessage(this.pool, threadId, {
              role: 'assistant',
              sender: agentId,
              content: event.summary,
              metadata: { source: 'fleet-executor', delegation_id: delegation.id },
            }).catch(() => {})
          }
        }
      })()

      const result = await handle.done
      await progressDone

      // Scope gate
      const worktreePath = await this.getWorktreePath(agentId)
      const allowedFiles = Array.isArray(delegation.request['allowed_files'])
        ? delegation.request['allowed_files'] as string[]
        : []

      if (worktreePath && allowedFiles.length > 0) {
        const violations = await checkScope(worktreePath, allowedFiles)
        if (violations.length > 0) {
          await routeResult(
            { pool: this.pool, primeQueue: this.primeQueue },
            delegation,
            { success: false, error: `scope violation: ${violations.join(', ')}` },
          )
          return
        }
      }

      await routeResult(
        { pool: this.pool, primeQueue: this.primeQueue },
        delegation,
        { success: true, result },
      )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      await routeResult(
        { pool: this.pool, primeQueue: this.primeQueue },
        delegation,
        { success: false, error: message },
      )
    }
  }

  private async getWorktreePath(agentId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ worktree_path: string | null }>(
      `SELECT worktree_path FROM agents WHERE id = $1`,
      [agentId],
    )
    return rows[0]?.worktree_path ?? null
  }
}

async function buildPrompt(pool: pg.Pool, delegation: Delegation): Promise<TaskPrompt> {
  const req = delegation.request
  const title = String(req['title'] ?? 'Task')
  const description = String(req['description'] ?? '')
  const allowedFiles = Array.isArray(req['allowed_files']) ? req['allowed_files'] as string[] : []
  const readFiles = Array.isArray(req['read_files']) ? req['read_files'] as string[] : []
  const verificationCmd = typeof req['verification_cmd'] === 'string' ? req['verification_cmd'] : undefined

  const template = await loadWorkspaceTemplate(pool, 'prompts/delegation/task.md', 'delegation/task.md')
  const text = renderTemplate(template, {
    title,
    description,
    read_files: readFiles.length > 0 ? readFiles.join('\n') : '(none specified)',
    allowed_files: allowedFiles.length > 0 ? allowedFiles.join('\n') : '(none — unscoped task)',
    verification_section: verificationCmd ? `## Verification\n\nRun: ${verificationCmd}\n\n` : '',
  })

  return { text, allowed_files: allowedFiles, read_files: readFiles, verification_cmd: verificationCmd }
}

async function checkScope(worktreePath: string, allowedFiles: string[]): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', worktreePath, 'diff', '--name-only', 'HEAD'])
    const changed = stdout.trim().split('\n').filter(Boolean)
    return changed.filter((f) => !allowedFiles.includes(f))
  } catch {
    return []
  }
}
