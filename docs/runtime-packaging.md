# Runtime Packaging and Growth Boundaries

PrimeLoop supports multiple packaging modes, but they are not equal in operational intent.

## Install Modes

### Recommended: prebuilt container install

Use [`docker-compose.prod.yml`](/home/james/projects/primeloop/docker-compose.prod.yml:1) with the published image `code.klsll.com/havartibard/primeloop:latest`.

This is the default operator path because it:

- avoids a local app build
- keeps the support surface narrow
- makes upgrades a matter of replacing the image while retaining durable state

### Advanced: local/source install

Use the source tree directly for development, debugging, or customization. This is supported, but it is not the default operator install path.

## State Model

The PrimeLoop application payload is replaceable. Durable state must live outside the app image or transient process filesystem.

### Durable state

- **Database state**: PostgreSQL records for goals, agents, approvals, catalog metadata, runtime state, and recovery state.
- **Managed workspaces and repos**: mounted workspace content such as `/workspace`, including agent worktrees, repo checkouts, prompt overrides, policy files, skills, and Prime profile files.
- **Approved extension/configuration artifacts**: catalog YAML, prompt/profile/policy overrides, and similar behavior-changing assets when stored in durable locations.

### Non-durable state

- the writable layer of the PrimeLoop application container
- transient local process state
- temporary build artifacts that are not mounted or committed

Replacing the app container or restarting a local process must not be the mechanism by which PrimeLoop preserves important agent output.

## Surface Classification

PrimeLoop code and configuration should be treated under four policy classes.

### `immutable-core`

Security-critical control-plane surfaces. Agents must not mutate these during normal operation.

Current examples:

- `backend/src/db.ts`
- `backend/src/credentials/`
- `backend/src/launcher/`
- `backend/src/runtime/`
- approval enforcement, broker enforcement, and runtime isolation code

Governance:

- product-engineering changes
- explicit high-trust operator escalation only

### `agent-extensible`

Durable, reviewable behavior modules that may evolve over time.

Current examples:

- `backend/catalog/*.yaml`
- workspace-backed prompt/profile/policy/skill artifacts created under the Prime workspace root by [`backend/src/workspace.ts`](/home/james/projects/primeloop/backend/src/workspace.ts:1)

Governance:

- reviewable changes with provenance
- may be changed by agents only through approved workflows

### `workspace-managed`

Repos and worktrees used for task execution.

Current examples:

- `AGENT_REPO_ROOT`
- `AGENT_WORKTREE_ROOT`
- PrimeLoop's own repo when intentionally mounted as a managed workspace for self-improvement

Governance:

- durable task work product
- independent of the installed application payload

### `operator-managed`

Deployment and installation configuration that operators control directly.

Current examples:

- `.env`
- Compose manifests
- host volume mappings

Governance:

- editable by operators and deployment workflows
- not a routine agent mutation surface

## Current Durable Extension Paths

These current code paths already back behavior-changing content with the workspace rather than the shipped image:

- [`backend/src/workspace.ts`](/home/james/projects/primeloop/backend/src/workspace.ts:1) scaffolds durable `agents/`, `prompts/`, `skills/`, `policies/`, `memory/`, and `config/` directories under the configured Prime workspace root.
- [`backend/src/routes/prime-profile.ts`](/home/james/projects/primeloop/backend/src/routes/prime-profile.ts:1) reads and writes Prime profile content through the workspace layer rather than editing shipped prompt files in place.
- [`backend/src/opencode/process-manager.ts`](/home/james/projects/primeloop/backend/src/opencode/process-manager.ts:1) writes agent-specific runtime files into worktrees rather than the installed app payload.

## PrimeLoop Self-Improvement Rule

If PrimeLoop improves itself, it must do so through one of these durable paths:

- a managed repository/worktree
- a durable extension surface
- a reviewed operator change

It must not rely on mutating the live application container filesystem and hoping that state survives redeploy.
