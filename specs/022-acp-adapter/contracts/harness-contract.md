# Contract: AcpHarness implements AgentHarness

`AcpHarness` realizes the existing `AgentHarness` interface (`fleet-executor/harness.ts`) over ACP.
The `HarnessEvent` union and `TaskResult` shape are **unchanged** — this is the stable internal
surface the `FleetDispatcher` and Prime runtime-truth consume. No consumer changes (SC-004 parity).

## Interface (unchanged surface)

```ts
interface AgentHarness {
  start(opts: { cwd: string; model: ModelRef }): Promise<void>
  dispatch(prompt: TaskPrompt): Promise<TaskHandle>   // { id, events, done }
  abort(taskId: string): Promise<void>
  close(): Promise<void>
}
```

## Behavior mapping

| AgentHarness call | ACP actions |
|---|---|
| `start({ cwd, model })` | spawn agent subprocess; `initialize`; verify protocolVersion; reconcile capabilities |
| `dispatch(prompt)` (first) | `session/new` with `cwd = sandbox root`; then `session/prompt` |
| `dispatch(prompt)` (subsequent) | `session/prompt` on existing `sessionId` |
| stream `handle.events` | `session/update` → `HarnessEvent` (table below) |
| `handle.done` | resolves on `stopReason` with `TaskResult { text, tokens, changed_files, ... }` |
| `abort(taskId)` | `session/cancel` |
| `close()` | terminate + reap subprocess |

## session/update → HarnessEvent

| ACP update | HarnessEvent |
|---|---|
| `agent_message_chunk` (text) | `{ type: 'message_update', delta }` |
| `tool_call` | `{ type: 'tool_call_start', tool, args }` |
| `tool_call_update` | `{ type: 'tool_call_start' }` updated / coalesced |
| `tool_call_result` | `{ type: 'tool_call_end', tool, result?, error? }` |
| `plan` | `{ type: 'progress', summary }` |
| prompt resolves (`stopReason`) | `{ type: 'task_end', result }` |
| (on start) | `{ type: 'task_start' }` |

## Invariants
- Existing `HarnessEvent` consumers compile and behave unchanged.
- `changed_files` in `TaskResult` derived from sandbox diff (reuse dispatcher `checkScope` source).
- Failures (crash/negotiation/malformed) reject `handle.done` and reap the subprocess.
- Selected by `OpenCodeProcessManager` when `runtime_family = 'acp'`; otherwise `PiHarness`.
