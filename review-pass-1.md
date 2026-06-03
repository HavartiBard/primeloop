# Review Pass 1: specs/023-repo-rename-plan/

**Reviewer**: review subagent  
**Date**: 2026-06-03  
**Artifacts reviewed**: `spec.md`, `plan.md`, `tasks.md`, `quickstart.md`, plus supporting files (`data-model.md`, `research.md`, `contracts/naming-contract.md`)

---

## Review

### Correct: what is already good

- **Spec requirements are well-structured and traceable.** 15 functional requirements (FR-001 through FR-010 with sub-clauses) cover all key dimensions: canonical naming, inventory completeness, in-repo vs external distinction, phased sequencing, risk identification, staged migration, historical preservation, and scope bounding.
- **Plan's phase structure (A–D) is clean and matches the spec's staged migration intent.** Phase A (branding) → B (docs) → C (operational identifiers) → D (external follow-ups) is logical and correctly sequenced.
- **Inventory table in plan.md covers the major surface categories well:** repo metadata, package metadata, deployment assets, scripts, database identifiers, volume paths, workspace paths, and environment variables. Current values were verified against actual files and are accurate.
- **Staged migration rule is explicit and defensible.** The distinction between "immediate rename targets" (Phase A/B) and "deferred by default" operational identifiers (Phase C) aligns with FR-007a.
- **Prime vs PrimeLoop distinction is consistently maintained** across all four artifacts. Prime is treated as an internal coordinator concept, not a parallel public brand.
- **Tasks.md maps cleanly to user stories and phases.** Dependencies are clearly stated, parallel opportunities are identified, and the MVP-first strategy is reasonable for a planning-only feature.
- **Quickstart provides actionable execution guidance** with concrete `rg` search commands, phase-by-phase instructions, and an external follow-up checklist template.

---

### Fixed: none (review-only pass; no edits applied)

---

### Blocker: none

No critical issues that would prevent safe execution of the rename plan. All identified items are gaps or inaccuracies that should be corrected before implementation begins but do not represent structural failures.

---

### Note: observations, risks, and follow-up items

#### 1. Missing inventory items — root-level active documents

**Location**: `plan.md` Rename Surface Inventory table (line ~318)

Two root-level active documents with legacy references are not in the inventory:

- **`SPEC-PLANNING.md`** — has 5 ACP references, is an active planning handoff document (status: "Constitution written, backlog stubs created"), not archival.
- **`HANDOFF.md`** — has 1 reference to `ACP_DEV_DATABASE_HOST`. Active developer-facing document.

Both should be added to the inventory table (likely as Phase B active-doc surfaces for SPEC-PLANNING.md, and Phase C operational for HANDOFF.md's env-var reference).

#### 2. Incomplete preserved historical specs list

**Location**: `plan.md` "Preserved Historical/Archive References" table (line ~341)

The table lists only 4 completed specs as preserved:
- `specs/002-agent-lifecycle-and-sandbox/spec.md` ✅ listed
- `specs/015-prime-routing-runtime-truth/spec.md` ✅ listed
- `specs/018-prime-onboarding-config/spec.md` ✅ listed
- `specs/022-acp-adapter/spec.md` ✅ listed

But repository search reveals additional specs with ACP references that are not listed:

| Spec | Status | ACP hits | Listed? |
|------|--------|----------|---------|
| 007-gitea-adapter | Stub | 3 | ❌ |
| 009-mcp-registry | Draft | 27 | ❌ |
| 010-credential-broker | (unknown) | 1 | ❌ |
| 012-knowledge-artifacts | (unknown) | 1 | ❌ |
| 016-agentic-control-plane | Draft | 3 | ❌ |
| 017-expand-agent-canvas-ux | **Done** | 4 | ❌ |
| 019-inline-chat-artifacts | (unknown) | 1 | ❌ |
| 020-chat-composer-controls | Draft | 9 | ❌ |
| 021-settings-admin-panel | (unknown) | 1 | ❌ |

**Recommendation**: Either (a) enumerate all specs with legacy references in the preservation table, or (b) add a blanket rule such as "All files under `specs/` are preserved for traceability per FR-008a; no spec is rewritten." Option (b) is simpler and less fragile against future additions.

#### 3. Docker network name factual error

**Location**: `plan.md` inventory table, deployment/network row (line ~324)

The table lists the current implicit Docker Compose network as `agentcontrolplane_default` (no hyphens). However, none of the compose files define an explicit `name:` key or custom network. Docker Compose derives the project name from the directory name (`agent-control-plane`), so the actual default network is **`agent-control-plane_default`** (with hyphens preserved). The target value should be correspondingly `primeloop_default`.

This is a minor factual inaccuracy but could cause confusion during Phase C verification.

#### 4. Quickstart Phase C verification commands are misleading

**Location**: `quickstart.md` Step 4, verification block (line ~70)

```sh
npm audit --prefix ./backend && npm audit --prefix ./web
```

`npm audit` checks for security vulnerabilities, not package identity. It does **not** verify that `package.json` names were updated after a rename. A more appropriate verification would be:

```sh
grep '"name"' backend/package.json web/package.json package-lock.json
```

Similarly, the inventory table's verification method for package-metadata rows says "Run `npm audit --prefix ./backend` after rename and verify package identity updates cleanly" — `npm audit` cannot verify package identity.

**Recommendation**: Replace `npm audit` with a direct `grep '"name"'` check or `cat package.json | jq .name` in both the quickstart and inventory table.

#### 5. Root `package.json` has no `"name"` field

**Location**: `plan.md` Project Structure section (line ~103) and tasks.md T010

The root `package.json` contains only:
```json
{
  "devDependencies": {
    "tsc": "^2.0.4"
  }
}
```

There is no `"name"` field to rename at the root level. The inventory correctly targets `package-lock.json` (which has `"name": "agent-control-plane"`), but T010 says "Inventory root repository metadata surfaces in README.md, AGENTS.md, package.json, and package-lock.json" — implying `package.json` is a rename surface when it isn't.

**Impact**: Low. This is a minor discrepancy that won't cause execution problems but could confuse an operator looking for a name field to change.

#### 6. UI label "ACP" in Sidebar.tsx should be explicitly flagged

**Location**: `plan.md` inventory table, ui-copy row (line ~328)

The inventory has a generic `web/src/**/*.tsx` entry for "Agent Control Plane, ACP labels in current-facing UI." However, the sidebar at `web/src/components/Sidebar.tsx:50` renders `ACP` as a visible navigation label — this is arguably the most prominent user-facing use of "ACP" in the product. It would be worth calling out explicitly rather than burying it under a glob pattern.

**Impact**: Low. The glob pattern does technically cover it, but explicit callout reduces the risk of an operator missing it during manual review.

#### 7. Backend `ACP` references are technical, not branding — correctly handled but worth noting

**Location**: `plan.md` Phase C "Backend String Coverage Note" (line ~235)

The plan correctly notes that backend references to "ACP" in comments and error messages (e.g., `backend/src/acp/types.ts`, `backend/src/fleet-executor/acp-harness.ts`) refer to the Agent Client Protocol or Agentic Control Plane system concept, not branding. These are properly excluded from rename targets.

However, the quickstart's search command (`rg -n "agent-control-plane|Agent Control Plane|\bACP\b"`) will produce many false positives from these technical references. The Phase B verification note in plan.md (line ~213) already acknowledges this: "returns no hits or only intentional technical acronym uses unrelated to branding."

**Impact**: Low. Already acknowledged, but operators should be aware that the `\bACP\b` pattern is noisy in this codebase.

---

## Summary

The four artifacts are well-constructed and internally consistent. The rename plan is thorough, phased correctly, and covers the major surfaces. The issues identified above are:

- **2 missing inventory items** (SPEC-PLANNING.md, HANDOFF.md) — worth adding now
- **1 incomplete preservation list** — 9 additional specs with legacy references not enumerated
- **1 factual error** (Docker network name format)
- **2 misleading verification commands** (`npm audit` for identity check)
- **2 minor clarifications** (root package.json has no name, Sidebar ACP label)
- **1 acknowledged noise source** (technical ACP acronym in backend)

None of these are blockers. The plan is execution-ready with these corrections applied.
