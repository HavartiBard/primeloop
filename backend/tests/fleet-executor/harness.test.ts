import { describe, it, expect } from 'vitest'
import type { AgentHarness, HarnessEvent, TaskHandle, TaskPrompt } from '../../src/fleet-executor/harness.js'

describe('AgentHarness interface', () => {
  it('describes a harness that can be implemented by a stub', async () => {
    const events: HarnessEvent[] = []
    const stub: AgentHarness = {
      async start() {},
      async dispatch(prompt: TaskPrompt): Promise<TaskHandle> {
        return {
          id: 'task-1',
          events: (async function* () {
            yield { type: 'task_start' } as HarnessEvent
            yield { type: 'task_end', result: { text: 'ok', tokens: 0 } } as HarnessEvent
          })(),
          done: Promise.resolve({ text: 'ok', tokens: 0 }),
        }
      },
      async abort() {},
      async close() {},
    }

    await stub.start({ cwd: '/tmp', model: { providerID: 'test', id: 'mock' } })
    const handle = await stub.dispatch({ text: 'hello', allowed_files: [], read_files: [] })
    for await (const ev of handle.events) events.push(ev)
    expect(events.map((e) => e.type)).toEqual(['task_start', 'task_end'])
    expect((await handle.done).text).toBe('ok')
  })
})
