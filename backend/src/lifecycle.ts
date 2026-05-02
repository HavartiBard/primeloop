import { Client } from 'ssh2'
import fs from 'fs'

export interface LifecycleResult { ok: boolean; output: string }
export type SshExecFn = (host: string, user: string, cmd: string) => Promise<LifecycleResult>

export function makeExecOnAgent(sshKeyPath: string): SshExecFn {
  return (host, user, cmd) => new Promise((resolve) => {
    const conn = new Client()
    let output = ''
    conn.on('ready', () => {
      conn.exec(cmd, (err, stream) => {
        if (err) { conn.end(); return resolve({ ok: false, output: err.message }) }
        stream.on('data', (d: Buffer) => { output += d.toString() })
        stream.stderr.on('data', (d: Buffer) => { output += d.toString() })
        stream.on('close', (code: number) => { conn.end(); resolve({ ok: code === 0, output }) })
      })
    })
    conn.on('error', (err) => resolve({ ok: false, output: err.message }))
    conn.connect({ host, username: user, privateKey: fs.readFileSync(sshKeyPath) })
  })
}

export function dockerLifecycle(
  exec: SshExecFn,
  host: string,
  user: string,
  container: string,
  action: 'restart' | 'stop' | 'start'
): Promise<LifecycleResult> {
  return exec(host, user, `docker ${action} ${container}`)
}
