# Setup Wizard Design

> **For agentic workers:** Use `superpowers:writing-plans` to produce the implementation plan from this spec.

**Goal:** A first-run setup wizard at `/setup` that guides users through LLM provider configuration, model routing, prime agent personality, and standing rules — ending with a one-click Launch that enables the prime agent.

**Architecture:** DB-tracked completion flag; wizard writes to existing tables (`providers`, `chief_profiles`, `prime_agent_config`) in a single `POST /api/setup/complete` call; frontend short-circuits to main app once setup is complete.

**Tech Stack:** React + TanStack Query (existing), Express (existing), PostgreSQL (existing)

---

## 1. Completion State

### DB migration

Add one column to `prime_agent_config`:

```sql
ALTER TABLE prime_agent_config
  ADD COLUMN IF NOT EXISTS setup_complete BOOLEAN NOT NULL DEFAULT false;
```

Existing rows stay `false` after migration, but the `/api/setup/status` endpoint short-circuits to `complete: true` if the `providers` table is non-empty. This ensures existing deployments with manually-configured providers never see the wizard.

### `GET /api/setup/status`

```ts
// Response
{ complete: boolean }
```

Logic:
1. Count rows in `providers`. If > 0, return `{ complete: true }`.
2. Otherwise read `prime_agent_config.setup_complete`. Return its value.

---

## 2. Backend Endpoints

All new endpoints live under `/api/setup`, mounted in `app.ts`.

### `GET /api/setup/status`

Described above. No auth beyond existing middleware.

### `GET /api/setup/ollama-models`

Query param: `base_url` (required).

Proxies `GET {base_url}/api/tags` to the local Ollama instance. Returns the model list or an error. Used by the Local provider card to auto-populate the model dropdown.

```ts
// Success response (Ollama format, pass-through)
{ models: Array<{ name: string; modified_at: string; size: number }> }

// Error response
{ error: string }
```

Timeout: 3 seconds. If Ollama is unreachable, return `{ error: 'unreachable' }` — the frontend falls back to a free-text model input.

### `POST /api/setup/complete`

Accepts the full wizard payload. Writes everything sequentially. On success, sets `setup_complete = true`.

```ts
// Request body
{
  providers: Array<{
    name: string       // e.g. "anthropic-main"
    type: string       // "anthropic" | "openai" | "ollama" | "litellm"
    base_url: string
    api_key?: string   // omitted for device-authed OpenAI
    model?: string
  }>
  routing: {
    planning:    Array<{ provider_name: string; model: string }>
    dispatching: Array<{ provider_name: string; model: string }>
    discussion:  Array<{ provider_name: string; model: string }>
  }
  persona: {
    name: string
    focus: string
    tone: 'direct' | 'thorough' | 'collaborative'
    instructions?: string   // free-form, optional
  }
  rules: {
    presets: string[]       // keys of selected preset rules
    custom: string          // free-form textarea value
  }
  cost_controls: {
    monthly_token_budget: number   // 0 = unlimited
  }
  launch: boolean   // true = set enabled=true on prime_agent_config
}
```

Write order:
1. Insert each provider via existing `insertProvider` (encrypt key with existing `encrypt()`). Skip any provider whose `id` is already present in the payload (pre-created for device auth). If a provider with the same `name` already exists, update it rather than inserting a duplicate.
2. Resolve `provider_routing`: map each route's `provider_name` to the newly-inserted (or pre-existing) provider `id`.
3. Upsert `chief_profiles` (id = `'default'`): assemble `persona` string and `operating_policy` string (see §4).
4. `UPDATE prime_agent_config SET provider_routing=$1, cost_controls=$2, enabled=$3, setup_complete=true WHERE id='default'`.

Return `{ ok: true }` on success, `{ error: string }` on failure. No partial rollback — if a step fails the frontend surfaces the error and the user can retry.

---

## 3. Frontend Structure

### Setup status check — `App.tsx`

On mount, `App` fetches `/api/setup/status` before rendering anything. While loading, show a neutral full-screen spinner. If `complete: false` and no `sessionStorage.getItem('setup-skipped')` flag, render `<Setup />` fullscreen instead of `<Layout />`.

The `<Setup />` component has a "Skip for now" link that sets `sessionStorage.setItem('setup-skipped', '1')` and causes `App` to re-render into `<Layout />`. The flag is session-scoped (gone when the tab closes).

### New files

```
web/src/hooks/useSetupStatus.ts   — fetches /api/setup/status, used by App
web/src/pages/Setup.tsx           — 5-step wizard, all state local
```

### `useSetupStatus`

```ts
export function useSetupStatus() {
  return useQuery({
    queryKey: ['setup-status'],
    queryFn: () => fetch('/api/setup/status').then(r => r.json()) as Promise<{ complete: boolean }>,
    staleTime: Infinity,   // re-check only on explicit invalidation
  })
}
```

After `POST /api/setup/complete` succeeds, invalidate this query and let `App` re-render into `<Layout />`.

---

## 4. Wizard Steps

All state is held in a single `WizardState` object in `Setup.tsx`. Nothing is written to the backend until step 5 "Launch."

```ts
interface WizardState {
  providers: ProviderDraft[]
  routing: RoutingDraft
  persona: PersonaDraft
  rules: RulesDraft
  costControls: { monthlyTokenBudget: number }
}
```

### Step 1 — Providers

Three cards: **Anthropic**, **OpenAI**, **Local**. Cards are inactive by default; clicking activates and expands inline.

**Anthropic card (expanded):**
- API key input (password type)
- Model field (default: `claude-sonnet-4-6`, editable)

**OpenAI card (expanded):**
- Two tabs: `API Key` | `Device Auth`
- API Key tab: API key input, optional base URL override (for Azure/proxy)
- Device Auth tab: device auth requires a real provider `id` before polling can start, so this tab breaks the "write-on-launch" rule. When the user clicks "Start device auth", the wizard immediately calls `POST /api/providers` to create the provider row (name: `openai-wizard`, type: `openai`) and stores the returned `id` in wizard state. Then it calls the existing `POST /api/codex/:id/device-auth/start`, displays the URL + one-time code, and polls until complete. `POST /api/setup/complete` skips re-inserting this provider (it detects the pre-created id in the payload and uses it directly).
- Model field (default: `gpt-4o`, editable)

**Local card (expanded):**
- Base URL input (default: `http://localhost:11434`)
- "Detect models" button: calls `GET /api/setup/ollama-models?base_url={url}`, populates a model dropdown. If detection fails, falls back to free-text model input.
- Model selector: dropdown (if detected) or text input (if not)
- Provider type radio: `Ollama` | `LiteLLM / Other` (controls the `type` field written to providers table)

Validation: at least one card must be fully configured to advance.

### Step 2 — Routing

Three route rows in a table: `planning`, `dispatching`, `discussion`.

Each row:
- **Primary**: provider dropdown (populated from step 1 provider names) + model text field (pre-filled from provider's default model)
- **+ Add fallback** button: appends a second provider+model pair below. The resulting array maps to `PrimeConfigRoute[]` in `prime_agent_config.provider_routing`.

Routes with no selection are left out of `provider_routing`; the LLM router already falls back to `planning` at runtime for unconfigured routes.

Below the routing table, a single field:

**Monthly token budget**: number input, placeholder `0 = unlimited`. Stored in `cost_controls.monthly_token_budget`. No enforcement logic in this version — value is persisted for the future cost-control guardrail feature.

### Step 3 — Personality

Structured fields:
- **Name**: text input, default `Prime`
- **Focus**: text input, placeholder `e.g. Senior backend engineer, DevOps specialist`
- **Tone**: three radio pills — `Direct & concise` | `Thorough & deliberate` | `Collaborative & inquisitive`

Expandable "Advanced" section (collapsed by default, toggle with chevron):
- **Additional instructions**: free-form textarea. Placeholder: `Behavioral notes, decision-making style, domain expertise, etc.`

These fields assemble into `chief_profiles.persona`:

```
You are {name}, {focus}.
Tone: {tone label}.

{instructions}   ← omitted if blank
```

### Step 4 — Standing Rules

Five preset rules as toggle rows (all off by default):

| Key | Label |
|-----|-------|
| `test_before_delegate` | Always run tests before delegating work to agents |
| `no_force_push` | Never force-push to main or protected branches |
| `small_prs` | Prefer small, reviewable pull requests over large ones |
| `confirm_destructive` | Ask before taking destructive or irreversible actions |
| `humans_in_loop` | Keep humans in the loop on external communications |

Below the toggles, a free-form textarea: **Additional rules** (placeholder: `Any other constraints or behaviors not listed above`).

These assemble into `chief_profiles.operating_policy`:

```
{selected preset rule labels, one per line}

{custom}   ← omitted if blank
```

### Step 5 — Review + Launch

A summary card divided into sections (Providers, Routing, Personality, Rules, Budget). Each section shows a compact read-only view of what will be written. An **Edit** link on each section jumps back to that step.

Two buttons at the bottom:
- **Launch Prime Agent** (primary) — submits with `launch: true`, prime agent starts immediately
- **Save & configure later** (secondary) — submits with `launch: false`, leaves `enabled: false`

On success: invalidate `setup-status` query → `App` re-renders into `<Layout />`.
On error: show inline error message with a Retry button. The endpoint is idempotent on providers (name-based dedup) so retrying is safe.

---

## 5. Prime Agent Persona Integration

`buildPrimeSystemPrompt` in `backend/src/prime-agent/llm-router.ts` is extended to pull from `chief_profiles`:

```ts
// New signature — pool passed through from callProvider
export async function buildPrimeSystemPrompt(context: PrimeContext, pool: pg.Pool): Promise<string>
```

At the top of the assembled prompt, before the fleet state sections, prepend:

```
{chief_profiles.persona}

## Standing Rules

{chief_profiles.operating_policy}

---
```

If `chief_profiles` has no row (wizard not run), the existing hardcoded preamble is used as-is — no regression for existing deployments.

---

## 6. What's Explicitly Out of Scope

- MCP server configuration (user directed to MCP page post-setup)
- Cost control enforcement / budget guardrails (value stored, logic deferred)
- Multi-user / auth (single-user homelab tool)
- Editing wizard config post-setup (use existing Providers / Governance pages)
