# AgentLoop Executive Operations Portal Implementation Plan

## Goal

Build a persistent homelab operations portal where the UI is a window into real agentic work. A primary Chief of Staff agent maintains context across turns, coordinates subagents and tools, manages approvals, tracks active work, and runs proactive audits.

The portal should not invent operational state in the browser. It should observe and control durable backend state.

## External Contracts

- MCP is the preferred tool access contract for files, shell, browser, GitHub/Gitea, docs, slides, spreadsheets, and other tool servers.
- A2A is the preferred agent interoperability contract where supported, using agent discovery, capabilities, task state, streaming, and auth.
- Runtime-specific adapters are required for providers that do not expose A2A, including external Hermes, OpenClaw, OpenCode, Codex App Server, Codex exec, and custom HTTP/WebSocket agents.
- Durable workflow execution should checkpoint before side effects, pause for approvals, and resume without replaying unsafe actions.
- Every handoff, tool call, approval, state change, and artifact should be traceable.

## System Model

The backend owns these responsibilities:

- Chief of Staff persona, policy, memory, and delegation rules.
- Agent registry with runtime family, endpoint, execution mode, capabilities, and trust zone.
- Tool registry with provider, scope, command rules, and permission policy.
- Thread and message state for talking to the Chief and team.
- Work ledger for handoffs, blockers, approvals, PRs, reviews, deployments, and follow-ups.
- Delegation runtime for assigning work to registered agents.
- Approval engine for human-gated actions and resumable continuations.
- Scheduler for hourly and recurring audits.
- Event stream for the portal, WebSocket clients, and audit history.

The frontend owns these responsibilities:

- Conversation surface for the Chief of Staff and team.
- Live circuit map of user, Chief, subagents, tools, and active work.
- Work ledger and approval queue.
- Agent and tool configuration screens.
- Memory and policy inspection/editing.
- Audit loop status and run history.

## Data Model

### Existing Tables To Keep

- `event_log`
- `approvals`
- `agent_heartbeat`
- `providers`
- `agents`
- `portal_state`

### New Tables

- `chief_profiles`: persona, operating policy, default model/provider, and delegation policy.
- `memories`: preferences, recurring duties, prior decisions, operational facts, and source references.
- `threads`: conversations with the Chief of Staff.
- `thread_messages`: user, Chief, subagent, tool, approval, and system messages.
- `work_items`: durable operational work with status, owner, priority, blockers, and links.
- `delegations`: assignments from Chief to agents, including request, result, state, and trace.
- `agent_runtime_configs`: runtime protocol, auth reference, trust zone, workspace, and limits.
- `tool_servers`: MCP servers and native tool providers.
- `tool_invocations`: command/tool calls, args, cwd, result, approval scope, and trace data.
- `permission_rules`: scoped command, filesystem, network, Git, agent, and tool policies.
- `audit_loops`: recurring duties and schedules.
- `audit_runs`: every proactive loop execution and result.
- `artifacts`: diffs, logs, PR links, deployment reports, screenshots, and generated files.
- `runtime_events`: unified append-only stream for portal and WebSocket clients.

## Agent Adapter Contract

All delegatable agents should be normalized through a backend adapter interface:

```ts
interface AgentAdapter {
  discover(agent: RegistryAgent): Promise<AgentCapabilities>
  health(agent: RegistryAgent): Promise<AgentHealth>
  startTask(request: AgentTaskRequest): AsyncIterable<RuntimeEvent>
  sendMessage(request: AgentMessageRequest): AsyncIterable<RuntimeEvent>
  getTask(taskId: string): Promise<AgentTaskState>
  cancelTask(taskId: string): Promise<void>
}
```

Initial adapters:

- `generic-http`: portable baseline for custom homelab agents.
- `hermes`: current external Hermes/Raclette integration.
- `a2a`: Agent Card discovery, task submission, status, and streaming.
- `opencode`: OpenCode headless server or SDK.
- `codex-app-server`: JSON-RPC session adapter for rich coding agents.
- `codex-exec`: one-shot exec adapter for CI-style tasks.
- `openclaw`: workspace/session adapter with strict filesystem isolation.
- `mcp-tool`: MCP tools exposed as callable capabilities when a full agent session is not needed.

## Coordinator Loop

1. Receive a user message, scheduled audit, webhook, or system event.
2. Load thread state, relevant memories, active work, pending approvals, agent health, and tool availability.
3. Classify intent: answer, create work item, delegate, request approval, run audit, update memory, or close work.
4. Select an agent/tool by capability, trust zone, runtime health, and permission policy.
5. Persist the work item, delegation, and planned action before side effects.
6. Stream concise status events as work starts, branches, blocks, changes, or completes.
7. Pause on approval or policy violation with a resumable continuation pointer.
8. Resume after approval and append every tool call, artifact, and decision.
9. Promote durable facts into memory only when they represent preferences, recurring duties, or prior decisions.
10. Close, reassign, or schedule follow-up work.

## Permission Model

Every tool call and delegation must pass through policy evaluation.

Scopes:

- Filesystem roots and read/write paths.
- Shell command prefixes, working directory, timeout, environment, and network requirement.
- Network domains, local subnet access, and internet access.
- Git remotes, branches, PR actions, pushes, and deployment gates.
- Secret references, with no raw secret display in traces.
- Agent-to-agent access and allowed downstream tools.
- Human approval requirements for destructive, external, deploy, secret, or broad-scope actions.

## API Plan

Initial routes:

- `GET /api/runtime/overview`
- `GET /api/threads`
- `POST /api/threads`
- `GET /api/threads/:id/messages`
- `POST /api/threads/:id/messages`
- `GET /api/work-items`
- `POST /api/work-items`
- `PUT /api/work-items/:id`
- `GET /api/delegations`
- `POST /api/delegations`
- `GET /api/memory`
- `POST /api/memory`
- `GET /api/audit-loops`
- `POST /api/audit-loops/:id/run`
- `GET /api/runtime/events`

Later routes:

- `POST /api/agents/:id/discover`
- `POST /api/agents/:id/tasks`
- `POST /api/agents/:id/messages`
- `POST /api/tools/:id/invoke`
- `POST /api/approvals/:id/resume`

## Frontend Plan

Primary screens:

- Command Center: Chief chat, active work, approvals, and live circuit map.
- Work Ledger: handoffs, blockers, PRs, reviews, deployments, and follow-ups.
- Agent Mesh: agents, runtimes, capabilities, health, trust zones, and adapter diagnostics.
- Tool Fabric: MCP servers, native tools, command rules, and permission scopes.
- Approvals: pending, approved, denied, expired, and resumed work.
- Memory: preferences, recurring duties, decisions, and editable facts.
- Audits: schedules, last runs, stale queues, failures, and follow-ups.

## Implementation Phases

1. Stabilize backend build and remove generated artifacts from the worktree.
2. Add durable runtime schema for threads, messages, work items, delegations, memory, permission rules, audits, tool invocations, artifacts, and runtime events.
3. Add backend store modules and routes for initial conversation, work ledger, memory, delegations, and runtime overview.
4. Add adapter interfaces and implement `generic-http` and `hermes` first.
5. Add Chief coordinator service that can create work, append messages, delegate through adapters, and emit runtime events.
6. Add approval pause/resume support for delegated tasks.
7. Rework the portal into a dense operations console backed by the new APIs.
8. Add scheduler-driven proactive audits using `node-cron`.
9. Add A2A, OpenCode, Codex App Server, Codex exec, and OpenClaw adapters.
10. Harden with policy tests, adapter contract tests, trace redaction, secret handling, and deployment smoke checks.

## Current Repository Starting Point

Already present or started:

- Express backend with Postgres migrations.
- Event log, approvals, agent heartbeat, providers, and agent registry.
- Agent registry fields for `runtime_family`, `execution_mode`, `endpoint`, and `capabilities`.
- Frontend portal shell and backend `portal_state` API.
- Nginx `/api/` reverse proxy change.

Immediate next work:

- Fix backend build dependency/type issues.
- Add runtime schema and store modules.
- Expose initial conversation/work/delegation APIs.
- Replace static portal sections with real thread and work data.
