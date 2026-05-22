# Agent Control Plane — Constitution

## Identity & Mission

ACP is a self-hosted Personal Chief of Staff for one human, running on their own server. The goal is async-first agentic work: goals are set in conversation ("staff meetings"), and results are delivered without minute-by-minute supervision.

ACP differentiates from local desktop agent products (e.g. OpenSwarm) by being always-on and multi-device, and from multi-tenant SaaS by being fully single-tenant — your data, your sandbox, your prompts, your server.

## Core Principles

### I. Three-Tier Agent Model

- **Prime** — single persistent CoS, user-facing. Orchestrates, decides, communicates. The only entry point for user intent.
- **Durable operational staff** — always-on, SDLC-shaped roles: **Architect** (design, ADRs, cross-cutting consistency), **SRE** (monitoring, incidents, health, reliability), **DevOps** (deploys, CI/CD, infrastructure). They keep ACP itself running and serve the same functions on user projects Prime delegates.
- **Ephemeral specialists** — single-purpose contractors spawned per task, reaped on completion. v1 templates: Researcher, Tech Writer, QA, Security. Prime can define one-off ephemerals when no template fits.

Note: SRE and DevOps overlap significantly in a single-tenant system; if their distinct charters don't justify the split after v1, they may be collapsed into one role.

### II. CoS as the Interface, Not the Canvas

The user always directs through Prime. All other UI surfaces (room workspace, circuit view, approval queue) support awareness and execution, but they are not the steering wheel. In v1, the room workspace is the primary operating surface and the circuit view is observational. Promoted actions route through Prime under the hood.

### III. Durable Artifacts of Record

Work is coordinated in ACP's database and mirrored to external systems-of-record (gitea, jira, knowledge base) where appropriate — not left in agent memory, session logs, or canvas state. Sessions are ephemeral; the durable record persists. Agents derive state from durable records, not the reverse.

### IV. Isolation Is a Property of the Agent, Not the Deployment

Every agent gets a per-agent git worktree, dedicated working directory (`/workspace/agents/<id>/`), per-process rlimits + cgroup, scoped environment variables, and broker-issued short-lived credentials. The deployment stays simple (two containers: `db` + `harness`), but per-agent boundaries are non-negotiable.

Harness crash = all agents die; the harness supervisor rebuilds in-flight state from the DB on restart. If this blast-radius tradeoff becomes unacceptable, migrate to per-agent containers behind the same agent-runtime interface.

### V. Tooling Is Layered, Not Flat

ACP exposes tools through layered contracts, not a flat bag of MCP endpoints. The layers are:

- **Platform primitives** — stable ACP actions such as delegation, approvals, artifact publishing, and work-item updates
- **Capability bundles** — policy-level groupings such as repo read/write, CI inspection, deploy staging, or knowledge search
- **Provider adapters** — concrete MCP servers, HTTP APIs, CLIs, or SDK-backed implementations behind a capability
- **Tool grants** — per-agent, per-run resolved access derived from role, task, approval state, and environment

Agents reason primarily about platform primitives and capabilities. Provider adapters stay swappable behind those contracts. Default policy is deny-by-default with least-privilege per-run grants.

### VI. Human-in-the-Loop at Decision Points, Not as a Fallback

Approvals are first-class objects. Reversible work auto-runs; irreversible or high-impact work pauses for the operator. This is a foundational design choice, not a safety net.

### VII. Observe, Don't Pilot

The circuit view (canvas) shows relationships across work, agents, approvals, and artifacts; the operator still steers via Prime. In v1, the canvas is an observational relationship view with promoted actions (approve, branch, ask Prime) that route through Prime. Rich live chat/tool interaction inside the canvas is a later phase and does not replace Prime-led orchestration.

### VIII. Single-Tenant, Self-Hosted by Design

One ACP instance = one human operator. No multi-user inside an instance. No multi-tenant infrastructure. Every architectural decision optimizes for one operator and their staff. Auth is a single operator token.

## System Primitives

- **Agent** — an actor with an identity, role, tier (prime / durable / ephemeral), lifecycle state, persona file, tool set, and isolated workspace. May be long-lived (Prime, durable staff) or task-scoped (ephemerals).
- **Work Item** — a tracked unit of work with lane, status machine, source, and metadata. Lives in the DB; mirrored to the system-of-record (gitea issue, jira ticket) where appropriate.
- **Sandbox** — the per-agent isolation contract: worktree + workdir + rlimits/cgroup + scoped env + broker credentials. Enforced by the harness at spawn time.
- **Approval** — a first-class object representing a paused action pending operator decision. Has a target action, context, expiry, decision, and audit trail.
- **Capability Profile** — a policy object mapping a role or task type to allowed platform primitives, capability bundles, escalation rules, and default denial behavior.
- **Tool Grant** — the resolved per-run tool exposure given to a specific agent execution, derived from its capability profile, task scope, approval state, and environment.
- **Provider Adapter** — a concrete implementation of a capability using MCP, HTTP, stdio, CLI, or SDK integration.
- **Knowledge Artifact** — a durable document (ADR, runbook, research note, decision log) that survives sessions, maintained by durable staff.

## Non-Goals (12-month horizon)

- Multi-user inside one instance
- Multi-tenant SaaS hosting
- Agent federation or cross-instance marketplaces
- Autonomous self-rewriting ACP code (agents propose; operator approves)
- Per-agent VM isolation (Firecracker, etc.) — revisit only if threat model changes
- Native desktop or mobile applications (web is the surface)

## Governance & Amendment

The Constitution constrains every feature spec under `specs/`. Before a feature spec may contradict a principle, the principle must be amended here first. Amendments require:

1. Explicit motivation (what changed and why)
2. Conflict callouts (which existing specs are affected)
3. Migration plan for affected backlog items

**Version**: 0.1 | **Ratified**: 2026-05-21 | **Last Amended**: 2026-05-21
