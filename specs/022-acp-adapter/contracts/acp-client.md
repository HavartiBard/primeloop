# Contract: ACP Client (control plane = ACP client)

The control plane is the ACP **client**; the spawned agent is the ACP **agent**. Transport is
JSON-RPC 2.0 over the subprocess's stdio. Source of truth for shapes: agentclientprotocol.com.

## Methods the client CALLS on the agent

### `initialize` (request)
Params: `{ protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false }, clientInfo: { name, version } }`
Result: `{ protocolVersion, agentCapabilities, authMethods?, agentInfo? }`
- Client MUST verify `protocolVersion` compatibility; on mismatch → fail task with actionable reason (Edge: version mismatch).
- `agentCapabilities` is authoritative → reconcile registry `capabilities[]` (FR-013).
- `terminal: false` — terminal not offered in v1.

### `session/new` (request)
Params: `{ cwd: <sandbox root, absolute>, mcpServers: [], additionalDirectories?: [] }`
Result: `{ sessionId, modes?, configOptions? }`
- `cwd` MUST be the agent's sandbox root (`worktree_path`/`workspace_root`).

### `session/prompt` (request)
Params: `{ sessionId, prompt: [{ type: 'text', text }, ...] }`
Result: `{ stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'cancelled' }`
- `stopReason` terminates the turn → emit `task_end` HarnessEvent.

### `session/cancel` (notification)
Params: `{ sessionId }`
- Sent on `AgentHarness.abort()`; agent halts current turn (stopReason `cancelled`).

## Notifications the client RECEIVES from the agent

### `session/update`
Params: `{ sessionId, update: { type, ... } }` — mapped to `HarnessEvent` (see harness-contract.md).
Variants handled: `agent_message_chunk`, `tool_call`, `tool_call_update`, `tool_call_result`, `plan`.
Variants ignored in v1: `current_mode_update`, `available_commands_update`.

## Methods the agent CALLS BACK on the client

### `session/request_permission` (request → client responds)
Params: `{ sessionId, toolCall: { id, name, input }, options: [{ optionId, name, kind }] }`
Response: `{ outcome: 'selected', optionId }` or `{ outcome: 'cancelled' }`
- Routed through the permission policy (see permission-policy.md).

### `fs/read_text_file` (request → client responds)
Params: `{ sessionId, path: <absolute>, line?, limit? }`
Response: `{ content }`
- `path` MUST resolve inside the sandbox root, else JSON-RPC error.

### `fs/write_text_file` (request → client responds)
Params: `{ sessionId, path: <absolute>, content }`
Response: `{}`
- Same sandbox confinement as read.

## Error / failure handling (FR-012)
- Subprocess crash, unparseable message, or JSON-RPC error → settle task `failed`, reap subprocess,
  emit diagnostic `runtime_event`. No orphan processes (SC-005).
