# Quickstart: ACP Adapter (local subprocess agent)

End-to-end validation that an ACP-compliant agent runs through the control plane with no
runtime-specific adapter code (spec SC-001/SC-002). Reference agent: **Gemini CLI**.

## Prerequisites
- Backend running per `README.md` (`./scripts/dev-up.sh`).
- An ACP-capable agent binary available locally (Gemini CLI in ACP mode).
- `@zed-industries/agent-client-protocol` installed in `backend/`.

## 1. Register an ACP agent
Register an agent with `runtime_family = 'acp'` and a launch command in `config`:

```jsonc
{
  "name": "gemini-acp",
  "runtime_family": "acp",
  "execution_mode": "local-subprocess",
  "workspace_root": "/path/to/sandbox/worktree",
  "config": {
    "acp": { "command": "gemini", "args": ["--acp"], "env": {} },
    "permission": { "default": "gate", "timeoutMs": 120000, "lowRiskTools": ["read_file", "list_dir"] }
  }
}
```

## 2. Dispatch work
Create a delegation targeting the agent (normal Prime/fleet path). Expected:
1. `OpenCodeProcessManager` selects `AcpHarness`, spawns the subprocess, runs `initialize`.
2. Negotiated capabilities reconcile onto the agent's registry `capabilities[]`.
3. `session/new` (cwd = sandbox) then `session/prompt`.
4. `session/update` notifications stream to the **canvas** as today's events.
5. Turn ends on `stopReason`; delegation routes a result.

## 3. Verify permission gating
Trigger a sensitive action (write outside sandbox / destructive op):
- An item appears in the **approval queue**; the agent is blocked.
- Approve → agent continues. Deny → agent aborts the action.
- Leave it unanswered past `timeoutMs` → auto-denied (fail-safe).
- Trigger a low-risk in-sandbox read → no approval item, agent proceeds.

## 4. Verify cancellation
Cancel a running task mid-turn → `session/cancel` sent, agent halts, task reaches terminal state,
no orphaned subprocess (`ps` shows none).

## 5. Verify legacy coexistence
Dispatch to an agent still on a legacy `runtime_family` (e.g., `opencode`) → runs via the deprecated
shim unchanged.

## Automated checks (Vitest)
```sh
cd backend
npm run test            # unit: acp client, update-mapper, permission policy, fs sandbox
npm run test:db:up && npm run test:db && npm run test:db:down   # dispatch integration
```

## Success signals
- SC-001: Gemini CLI completes a task end-to-end, no bespoke adapter code.
- SC-003: sensitive permissions gate; low-risk auto-resolve.
- SC-004: canvas parity with prior stream.
- SC-005: cancelled task leaves no orphan process.
- SC-006: legacy path still works via deprecated shim.
