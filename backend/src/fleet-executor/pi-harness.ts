import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { AgentHarness, HarnessEvent, ModelRef, TaskHandle, TaskPrompt, TaskResult } from './harness.js'

export class PiHarness implements AgentHarness {
  private proc: ChildProcess | null = null

  async start(opts: { cwd: string; model: ModelRef }): Promise<void> {
    const proc = spawn('pi', ['--mode', 'rpc'], {
      cwd: opts.cwd,
      env: {
        ...process.env,
        PI_MODEL: opts.model.id,
        PI_PROVIDER: opts.model.providerID,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.proc = proc

    await new Promise<void>((resolve, reject) => {
      const rl = createInterface({ input: proc.stdout! })

      const onLine = (line: string) => {
        let msg: Record<string, unknown>
        try { msg = JSON.parse(line) } catch { return }
        if (msg['type'] === 'ready') {
          rl.off('line', onLine)
          resolve()
        }
      }

      rl.on('line', onLine)

      proc.on('close', (code) => {
        reject(new Error(`pi process exited before ready (code ${code})`))
      })
    })
  }

  async dispatch(prompt: TaskPrompt): Promise<TaskHandle> {
    if (!this.proc) throw new Error('PiHarness not started')

    const id = crypto.randomUUID()
    const stdin = this.proc.stdin!

    stdin.write(
      JSON.stringify({
        type: 'prompt',
        text: prompt.text,
        allowed_files: prompt.allowed_files,
        read_files: prompt.read_files,
      }) + '\n',
    )

    const proc = this.proc
    const events = this.makeEventIterable(proc)

    const done = new Promise<TaskResult>((resolve, reject) => {
      ;(async () => {
        for await (const event of this.makeEventIterable(proc)) {
          if (event.type === 'task_end') {
            resolve(event.result)
            return
          }
        }
        reject(new Error('pi process closed without agent_end'))
      })()
    })

    return { id, events, done }
  }

  async abort(_taskId: string): Promise<void> {
    this.proc?.stdin?.write(JSON.stringify({ type: 'abort' }) + '\n')
  }

  async close(): Promise<void> {
    const proc = this.proc
    if (!proc) return
    this.proc = null
    proc.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { proc.kill('SIGKILL'); resolve() }, 5000)
      proc.on('close', () => { clearTimeout(timer); resolve() })
    })
  }

  private async *makeEventIterable(proc: ChildProcess): AsyncIterable<HarnessEvent> {
    const rl = createInterface({ input: proc.stdout! })
    for await (const line of rl) {
      let msg: Record<string, unknown>
      try { msg = JSON.parse(line) } catch { continue }

      switch (msg['type']) {
        case 'tool_execution_start':
          yield { type: 'tool_call_start', tool: String(msg['tool']), args: (msg['args'] ?? {}) as Record<string, unknown> }
          break
        case 'tool_execution_end':
          yield { type: 'tool_call_end', tool: String(msg['tool']), result: msg['result'], error: msg['error'] as string | undefined }
          break
        case 'message_update':
          yield { type: 'message_update', delta: String(msg['delta'] ?? '') }
          break
        case 'agent_end':
          yield { type: 'task_end', result: msg['result'] as TaskResult }
          return
      }
    }
  }
}
