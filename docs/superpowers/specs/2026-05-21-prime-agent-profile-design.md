# Prime Agent Profile — Design

**Status:** Draft for review
**Date:** 2026-05-21
**Branch context:** `feature/conversation-first-workflow`

## Problem

The default Prime profile today is five generic bullets in `backend/prompts/agents/prime.md`. The setup wizard's Personality step only collects `name`, `focus`, a tone preset, and a free-text instructions blob. There is no robust default that gives Prime a real personality and behavior model out of the box, and no path for the user to refine that profile after launch other than editing the wizard's free-text field.

Two outcomes are missing:

1. **A robust default profile** that ships with Prime — opinionated identity, voice, decision style, default behaviors, and approval thresholds.
2. **Intake bootstrapping** that lets the user adjust the defaults — or start from scratch — both in the setup wizard *and* conversationally in the onboarding thread after launch.

## Goals

- Ship a structured, opinionated default profile for Prime spanning identity, voice, decision style, behaviors, and approval thresholds.
- Let the user edit the profile section-by-section in the setup wizard, with a markdown editor toggle for power users.
- Let the user (or a fresh install) start from scratch with empty section fields.
- Let Prime offer a proactive guided tour of the profile in the onboarding thread, and accept conversational refinement ("be more cautious", "start over", "update voice section to X") that applies edits with a visible diff.
- Define explicit approval guardrails: which categories Prime escalates to the human (whether Prime is the actor or a delegate is asking for authorization) and which categories Prime can auto-approve for delegates.

## Non-goals

- Propagating standing rules from `policies/standing-rules.md` into delegation prompts. Today they apply only to Prime's prompt; that stays as-is. Flagged as a future spec.
- A `rename_self` action for Prime to change its display name conversationally.
- Profile diff history or undo timeline beyond the chat thread audit trail.
- Multi-agent profiles for delegated agents. This design only touches Prime.

## Scope

Profile only. The standalone Rules step in the wizard, the `policies/standing-rules.md` file, and the delegation policy file remain untouched.

## Architecture overview

**Single source of truth: the workspace files.** Two markdown files in `agents/` of the user's designated Agent workspace, with `## Section` headings as parseable markers:

- **`agents/prime-soul.md`** — portable identity layer. Sections: *Identity*, *Voice & Tone*, *Decision Style*. This is "who Prime is" — designed to travel with the user across projects.
- **`agents/prime.md`** — operational layer (this file slot already exists). Sections: *Default Behaviors*, *Approval Thresholds*. This is "how Prime works in this workspace" — naturally project-specific.

The split mirrors the existing convention partially in place (`backend/prompts/agents/default-soul.md` and `default-instructions.md`). It also means a user starting a second project can copy the soul file and not the operating file.

**Parser splits markdown into named sections** for the wizard and the action handler. Render is the inverse — sections written in canonical order, empty sections elided, unknown headings preserved verbatim through round-trip.

**Backwards compat with `chief_profiles.persona`:** every profile write also updates the existing `persona` column with the concatenation of the rendered soul markdown followed by the rendered operating markdown (separated by a blank line). This preserves the tertiary fallback in `llm-router.ts:220` without a schema change. The column now stores the full Prime profile text, which is what the fallback expects.

## Default content

These ship as `backend/prompts/agents/prime-soul.md` and `backend/prompts/agents/prime.md` (the built-in templates loaded when the workspace file is missing or the user resets).

### `prime-soul.md`

```markdown
# Prime — Soul

## Identity
I'm Prime, the coordination layer for this agent control plane. My job is to take user
intent, decide whether to act directly or delegate, and keep the user oriented on what
is actually happening. I am not the implementer — I am the orchestrator. When I
delegate, I own the outcome; I do not hand off and forget.

## Voice & Tone
- Direct, concrete, and grounded in progress that already happened or is about to happen.
- Short sentences over long ones. The user's terminology over generic AI phrasing.
- I do not acknowledge work — I do it, delegate it, or explain why I can't.
- When uncertain, I say so plainly. I do not hedge with disclaimers.
- I never narrate internal deliberation; I report decisions and their outcomes.

## Decision Style
- Smallest useful next step over comprehensive upfront plans.
- Fast feedback loops over careful design when the move is reversible.
- For reversible moves I pick one reasonable option and proceed.
- For irreversible moves I pause and confirm.
- I batch independent operations into parallel work whenever I can.
- I trust the conversation context and memory before re-exploring the codebase.
```

### `prime.md`

```markdown
# Prime — Operating Profile

## Default Behaviors
- When the user gives me a task, I evaluate the smallest delegation that completes it.
- Every delegation becomes a tracked work item with an owner, scope, and verification step.
- I surface blocked, stale, or pending-approval items proactively — not when asked.
- I report outcomes, not progress: "Tests pass on branch X" beats "I'm running tests."
- I use the active thread as the coordination surface; I do not spin up new threads for
  the same goal.

## Approval Thresholds
These categories need explicit human approval, whether I am about to take the action
myself or a delegate is asking me to authorize it.

**Always escalate to the human:**
- Destructive operations on user data, branches, or shared infrastructure.
- Spending against external budgets (paid APIs, third-party services).
- Outbound communication to humans outside this control plane (emails, PR comments,
  customer-facing replies).
- Actions the user has flagged "ask first" in standing rules.

**I can auto-approve for delegates:**
- Read-only operations and verification commands.
- File edits within the scope listed in the delegation.
- Tool calls the delegation explicitly pre-authorized.
- Re-runs of a previously-approved action with the same scope.

If a request lands in the gray zone between these lists, I escalate.
```

## Parser and renderer

In `backend/src/workspace.ts`:

```ts
type ProfileFile = 'soul' | 'operating'
type SectionKey =
  | 'identity' | 'voice_tone' | 'decision_style'
  | 'default_behaviors' | 'approval_thresholds'

const SECTION_HEADINGS: Record<SectionKey, { file: ProfileFile; heading: string }> = {
  identity:            { file: 'soul',      heading: 'Identity' },
  voice_tone:          { file: 'soul',      heading: 'Voice & Tone' },
  decision_style:      { file: 'soul',      heading: 'Decision Style' },
  default_behaviors:   { file: 'operating', heading: 'Default Behaviors' },
  approval_thresholds: { file: 'operating', heading: 'Approval Thresholds' },
}

parseProfileSections(markdown: string, file: ProfileFile): Partial<Record<SectionKey, string>>
renderProfileSections(file: ProfileFile, sections: Partial<Record<SectionKey, string>>): string
```

**Parser rules:**
- Split on lines matching `^## (.+)$`.
- Map heading text to `SectionKey` via `SECTION_HEADINGS` (case-insensitive, trimmed).
- Section body is everything until the next `^## ` or end of file. Trailing and leading blank lines trimmed.
- Unknown headings are preserved verbatim (heading + body) and round-trip cleanly. User-added custom sections are not lost; they are simply not editable through the wizard.
- Missing sections render as empty strings. The runtime tolerates empty sections; the wizard surfaces the gap.

**Renderer rules:**
- Walk sections in the canonical order defined by `SECTION_HEADINGS`.
- Skip empty sections — do not emit a heading with no body. This matters when the user "starts from scratch" and leaves some sections blank.
- Append preserved unknown sections at the end, after the canonical sections.

## Wizard UX

Replaces the existing Personality step (step 3) in `web/src/pages/Setup.tsx`.

**Header.** Agent display name input (kept as a top-level field — it is used in many places: thread sender, greeting, prompt substitutions). Adjacent `Sections` / `Markdown` view-mode toggle.

**"Who Prime is" panel (soul).** Three labeled multiline textareas pre-filled with the soul defaults: Identity, Voice & Tone, Decision Style. Per-section ↩ "Reset to default" link appears only when the field differs from the shipped default.

**"How Prime works here" panel (operating).** Two labeled multiline textareas pre-filled with the operating defaults: Default Behaviors, Approval Thresholds. Same per-section reset link.

**Footer controls.**
- **Clear all (start from scratch)** — wipes every section to an empty field. Labels remain visible. The user authors from scratch.
- **Reset all to defaults** — restores every section to the shipped default.

**Markdown mode.** Swaps the section panels for two larger textareas — one per file — showing the rendered markdown of `prime-soul.md` and `prime.md`. Switching back to Sections re-parses. If a canonical section heading was deleted in markdown mode, a non-blocking warning is shown ("Identity section missing — Prime will run without an Identity section unless you restore it") and the corresponding form field shows empty.

**Wire format.** The wizard POSTs to `/api/setup/complete` with:

```ts
profile: {
  name: string
  soul:      { identity: string; voice_tone: string; decision_style: string }
  operating: { default_behaviors: string; approval_thresholds: string }
}
```

**Backwards compat.** The endpoint still accepts the legacy `persona: { name, focus, tone, instructions }` payload for one release. If `profile` is present it wins. Otherwise legacy fields are mapped: `focus` → Identity, the tone preset's label → Voice & Tone, `instructions` → Decision Style.

**Step progress scoring (`stepProgress(state, 3)`).** Rewritten to score the new fields: `name` (0.2) plus each non-empty section (0.16 each across 5 sections = 0.8).

## Conversational refinement in the onboarding thread

**Opening message.** Today the onboarding thread opens with a single generic greeting in `runtime.ts:194` and `setup.ts:252`. It becomes a two-part message:

1. Standard greeting using Prime's name.
2. A 2–3 sentence summary of the active profile, generated by reading the parsed sections — e.g., *"You set me up as direct, decisive, and quick to delegate. I escalate to you on destructive ops, paid APIs, and outbound comms. Want to adjust anything before we start, or jump straight into work?"*

The summary is built by a small helper that takes parsed sections and produces a one-paragraph synopsis. The shipped default has a hand-written synopsis. Custom profiles use a templated paragraph that names which sections diverge from the default.

**System prompt addition.** `backend/prompts/prime/system.md` gains a paragraph: if the active thread has `metadata.kind == 'onboarding'` and the user's first message engages with profile content (e.g., "be more X", "change Y", "reset Z"), use the `update_profile` action. If the first message is a real task, drop the tour and proceed.

**New `update_profile` action.** Added to the JSON action schema in `backend/src/prime-agent/llm-router.ts` (alongside `delegate / update_work_item / request_approval / no_op`):

```ts
{
  type: 'update_profile',
  payload: {
    file: 'soul' | 'operating',
    section_key: SectionKey,
    new_text: string,
    reason: string,
  }
}
```

**Action handler behavior (`backend/src/prime-agent/actions.ts`).** When Prime emits `update_profile`:

1. Validate `section_key` against the allow-list. Reject unknown keys.
2. Load the current section text from the workspace file.
3. Compute a unified diff between current and `new_text`.
4. Re-render the full file (preserving untouched sections and any unknown headings) and write it to the workspace.
5. Update `chief_profiles.persona` with the concatenated soul + operating markdown.
6. Append a chat message in the thread showing the rendered diff and the `reason`.
7. Emit a `prime.action.update_profile` event for audit.

**Auto-apply with visible diff** is the confirmation model — not request-then-confirm. Profile edits are low-risk and fully reversible: the user can say "undo" or "revert the voice section" and Prime emits the inverse `update_profile`. The diff appended to the chat is the audit trail. Requiring explicit per-change confirmation would make the tour feel bureaucratic.

**Reset via chat.** When the user says "reset your profile" or "start over with the defaults", Prime emits multiple `update_profile` actions in one turn — one per section restoring the shipped default text. The reset appears as a single chat message with the combined diff.

## API surface

New endpoints in `backend/src/routes/prime-agent.ts`:

```
GET    /api/prime-agent/profile
       → {
           name: string,
           soul:      { identity, voice_tone, decision_style },
           operating: { default_behaviors, approval_thresholds },
           defaults_match: Record<SectionKey, boolean>,
         }

PUT    /api/prime-agent/profile
       body: { name?: string, soul?: {...}, operating?: {...} }
       → re-renders both files, writes to workspace,
         updates chief_profiles.persona with the concatenated soul + operating markdown.

PATCH  /api/prime-agent/profile/sections/:key
       body: { new_text: string }
       → updates a single section through the same write path.
```

`defaults_match` is computed per section by comparing parsed text against the shipped default. It drives the "Reset to default" link visibility in the wizard.

**Setup endpoint changes (`backend/src/routes/setup.ts`).**

- Accepts the new `profile` object alongside the legacy `persona`.
- If `profile` is present, calls the same render-and-write path as `PUT /profile`.
- If only `persona` is present, maps legacy fields into sections and writes both files.
- `writeWorkspaceSetupFiles()` is extended to write both `agents/prime.md` AND `agents/prime-soul.md` instead of the single thin file generated today.

## LLM router and prompt changes

In `backend/src/prime-agent/llm-router.ts` and `backend/src/workspace.ts`:

- Template loader gains a `primeSoul` key mapping to `agents/prime-soul.md` with `backend/prompts/agents/prime-soul.md` as fallback.
- System prompt template substitution receives `{{prime_soul}}` and `{{prime_profile}}` separately and concatenates them in the system prompt — soul first (identity establishes context), operating second (behaviors and thresholds).
- The action JSON schema gains `'update_profile'` in the type enum and a payload sub-schema for `{file, section_key, new_text, reason}`.
- `backend/prompts/prime/system.md` documents the new action and adds the onboarding-thread instruction described above.

## Migration and backward compatibility

**No schema migration required.** `chief_profiles.persona` keeps holding rendered text. We now write the concatenated soul + operating markdown into it on every profile change, for backward compat with `llm-router.ts:220`'s fallback.

**Existing users (already completed setup with old wizard).** On first `GET /api/prime-agent/profile`, if the workspace has only the legacy thin `prime.md` and no `prime-soul.md`, the server materializes `prime-soul.md` from the shipped default and leaves the existing `prime.md` untouched. The user sees defaults in the soul panel and their existing content in the operating panel. Nothing is overwritten.

**Built-in templates.** `backend/prompts/agents/prime.md` and the new `backend/prompts/agents/prime-soul.md` are updated with the rich defaults so fresh installs render correctly before workspace scaffolding runs.

**Legacy setup payload acceptance.** `POST /api/setup/complete` accepts `profile` (new) OR `persona` (legacy). The mapping is documented in the wizard section.

## Testing

New backend tests:

- **`backend/tests/prime-agent/profile-parser.test.ts`** — parser + renderer:
  - Round-trip: parse → render → parse yields the same map.
  - Missing section: parser returns empty string; renderer omits the heading.
  - Unknown headings preserved through round-trip.
  - Whitespace tolerance: extra blank lines, trailing spaces, CRLF.
  - Case-insensitive heading match.
  - Renderer skips empty sections.

- **`backend/tests/routes/prime-agent-profile.test.ts`** — endpoint behavior:
  - GET returns parsed sections and `defaults_match` flags.
  - PUT writes both files and updates `chief_profiles.persona`.
  - PATCH single section preserves the others.
  - Invalid `section_key` is rejected.
  - Legacy migration: workspace with old `prime.md` only → `prime-soul.md` materialized from default.

- **`backend/tests/routes/setup-profile.test.ts`** (extends existing setup tests):
  - New `profile` payload writes both files.
  - Legacy `persona` payload still works and maps to sections correctly.

- **`backend/tests/prime-agent/update-profile-action.test.ts`**:
  - Action with valid `section_key` writes section, emits event, emits chat message with diff.
  - Action with invalid key is rejected.
  - Reset-to-default: action with `new_text` matching the shipped default round-trips correctly.
  - Multi-action turn (full reset): each section updates independently.

New frontend test (following the `web/tests/<area>/<name>.test.tsx` layout already in place):

- **`web/tests/pages/Setup.personality.test.tsx`**:
  - Default render shows pre-filled sections.
  - "Reset to default" appears only when a section differs.
  - "Clear all (start from scratch)" wipes every section.
  - Markdown toggle swaps modes, parses on the way back, surfaces missing-section warning.
  - Submit payload shape matches the documented contract.

## Files touched

| Path | Change |
|------|--------|
| `backend/prompts/agents/prime.md` | Replace with rich default (Default Behaviors, Approval Thresholds). |
| `backend/prompts/agents/prime-soul.md` | New. Rich default (Identity, Voice & Tone, Decision Style). |
| `backend/prompts/prime/system.md` | Add onboarding-tour instruction and `update_profile` action documentation. |
| `backend/src/workspace.ts` | Add `parseProfileSections` / `renderProfileSections`. Extend template loader for `primeSoul`. Extend `writeWorkspaceSetupFiles` to write both files. |
| `backend/src/routes/setup.ts` | Accept structured `profile` payload. Map legacy `persona` to sections. Write both files. |
| `backend/src/routes/prime-agent.ts` | New GET/PUT/PATCH profile endpoints. |
| `backend/src/prime-agent/actions.ts` | New `update_profile` action handler with diff-then-apply. |
| `backend/src/prime-agent/llm-router.ts` | Add `update_profile` to action enum + payload schema. Pass `{{prime_soul}}` into system prompt. |
| `backend/src/runtime.ts` | Onboarding greeting includes profile synopsis and tour offer. |
| `web/src/pages/Setup.tsx` | Rewrite Personality step: section panels, markdown toggle, clear/reset controls. Update step progress scoring. |
| `web/src/types.ts`, `web/src/api.ts` | Types and fetchers for the structured profile. |
| `backend/tests/...` and `web/tests/pages/...` | New tests per the Testing section. |

## Open questions

None. Scope, storage model, file split, approval shape, wizard layout, and chat refinement model were resolved during brainstorming.

## Future work (flagged during brainstorming)

- Propagate `policies/standing-rules.md` into delegation prompts so the whole fleet sees them.
- `rename_self` action for Prime to update its display name conversationally.
- Profile diff history / undo timeline beyond the chat thread audit trail.
- Structured profiles for delegated agents.
