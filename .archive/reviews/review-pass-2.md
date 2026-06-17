## Review: specs/023-repo-rename-plan/plan.md — Pass 2 (Execution Readiness)

**Reviewer**: adversarial review subagent
**Date**: 2026-06-03
**Scope**: Phase definitions, inventory rows, operational identifiers, preservation policy, internal consistency against actual repository evidence.

---

### Correct: What Is Already Good

- **Phase sequencing is sound**: A (branding) → B (active docs) → C (operational identifiers) → D (external follow-ups) matches FR-007a and the staged migration rule. Verified against actual file structure — all mentioned compose files, scripts, and source directories exist.
- **Preservation policy is consistent with spec**: Historical specs and `docs/superpowers/plans/` are correctly excluded from active rename. Verified that these files do contain legacy references (`ACP`, `agent-control-plane` paths) that should be preserved.
- **Canonical naming targets table is coherent**: PrimeLoop as public brand, Prime as internal-only, `primeloop` as slug family — all internally consistent and aligned with spec clarifications.
- **Staged migration rule correctly defers operational identifiers**: Package names, image names, network names, env vars, and scripts are properly deferred to Phase C with explicit rationale citing FR-007a.
- **Docker compose inventory is accurate for DB names, volume paths, and image references**: Verified `agent_cp`, `/mnt/user/appdata/agent-cp/*`, and `code.klsll.com/havartibard/agent-control-plane:latest` against actual file contents in all four compose files.
- **Rollback guidance per phase is practical**: Each phase has specific rollback steps appropriate to its risk level (text-only for A/B, runtime-aware for C, manual for D).

---

### Fixed: Issues With Recommended Corrections

_(No edits applied — review-only mode. These are concrete issues worth fixing before execution.)_

#### Issue 1 — Missing Environment Variables in Inventory (Medium Risk)

**Location**: Rename Surface Inventory → env-var row
**Evidence**: The inventory lists `ACP_DEV_DATABASE_*`, `ACP_BACKEND_URL`, `ACP_VM_IP` as the env vars to migrate. Four additional ACP-prefixed variables exist and are NOT listed:

| Variable | File | Line |
|----------|------|------|
| `ACP_CORS_ORIGINS` | `backend/src/app.ts` | 148 |
| `ACP_MINIMAL_BOOT` | `backend/src/index.ts` | 26 |
| `ACP_STARTUP_TRACE` | `backend/src/index.ts` | 27 |
| `ACP_AGENT_WORKSPACE` | `backend/src/workspace.ts` | 56 |

**Impact**: If Phase C renames only the listed env vars, these four will remain as `ACP_*` while others become `PRIMELOOP_*`, creating an inconsistent naming landscape and potential operator confusion.

**Recommendation**: Add a row (or extend the existing env-var row) to cover `ACP_CORS_ORIGINS`, `ACP_MINIMAL_BOOT`, `ACP_STARTUP_TRACE`, and `ACP_AGENT_WORKSPACE`. Alternatively, if these are intentionally excluded because they reference the "Agent Client Protocol" acronym (see Issue 2), document that exclusion explicitly.

---

#### Issue 2 — Unresolved Ambiguity: ACP as Product Brand vs. Technical Protocol (Medium-High Risk)

**Location**: Entire inventory; especially backend-string row and Phase A/B verification commands
**Evidence**: The codebase uses "ACP" to mean two different things:

1. **Product brand**: "Agent Control Plane" — the name being renamed to PrimeLoop. Found in `README.md`, `AGENTS.md`, `web/index.html`, `web/src/pages/Setup.tsx` (lines 777, 870, 871, 1538, 1599, 1712, 1716).

2. **Technical protocol**: "Agent Client Protocol" — a separate protocol (`agentclientprotocol.com`) referenced in `backend/src/acp/types.ts` line 2: `ACP (Agent Client Protocol)`. Also found in `backend/src/acp/client.ts`, `backend/src/acp/permission.ts`, `backend/src/acp/update-mapper.ts`, `backend/src/fleet-executor/acp-harness.ts`, `web/src/lib/chatDisplayEvents.ts`, and others.

**Impact**: Phase A verification command `rg "Agent Control Plane|ACP" README.md web/index.html` is fine because it targets specific files. But the broader inventory uses "ACP" as a catch-all legacy pattern without distinguishing protocol references from brand references. A naive search-and-replace of "ACP" would break the Agent Client Protocol references.

**Recommendation**: Add an explicit exclusion note to the plan: "References to 'ACP' meaning 'Agent Client Protocol' (found in `backend/src/acp/`, `backend/src/fleet-executor/acp-harness.ts`, `web/src/lib/chatDisplayEvents.ts`, etc.) are NOT rename targets. Only 'ACP' used as shorthand for 'Agent Control Plane' in user-facing or branding contexts should be renamed." Update verification commands to avoid matching protocol references.

---

#### Issue 3 — Missing `web/src/pages/Setup.tsx` Placeholder Path (Low Risk)

**Location**: Rename Surface Inventory → workspace-path row
**Evidence**: The inventory lists `web/src/pages/Setup.tsx` under the workspace-path category for `/var/lib/agent-cp/workspace`. However, the actual reference is at line 1572 as a **UI placeholder attribute**: `placeholder="/var/lib/agent-cp/workspace"`. This is user-facing text in an input field, not just a backend path constant.

**Impact**: Low — it will likely be caught during manual review of Phase A/B. But the inventory should explicitly note it as a UI-facing surface so the operator knows to verify the rendered output.

**Recommendation**: Add `web/src/pages/Setup.tsx:1572` (placeholder attribute) to the workspace-path row or add a separate ui-copy sub-row for it.

---

#### Issue 4 — Docker Network Naming Mechanism Misunderstood (Low Risk, Conceptual)

**Location**: Rename Surface Inventory → deployment row (implicit default network)
**Evidence**: The inventory lists `agentcontrolplane_default` as a target with compose files as the location. However, Docker Compose derives implicit network names from the **project directory name** or `-p` flag, not from anything inside the compose files. You cannot rename the implicit network by editing `docker-compose.yml`.

**Impact**: The operator may waste time trying to add network name overrides to compose files when the actual fix is either renaming the project directory or using `docker compose -p primeloop`.

**Recommendation**: Clarify this row: note that implicit Docker network naming is controlled by the project directory name (`agent-control-plane` → `primeloop`) or explicit `-p` flag, not by compose file edits. Consider moving this to Phase D (external follow-ups) since it depends on filesystem-level changes.

---

#### Issue 5 — Phase B Rollback Guidance References Preserved Files (Minor Inconsistency)

**Location**: Rollback Guidance section, step 2
**Evidence**: The rollback guidance says: "Phase B rollback: Restore docs/superpowers/plans/\*.md from git history; preserve archival references." But Phase B explicitly states these files are **preserved and not modified**. There is nothing to restore for them.

**Impact**: Confusing for operators — implies Phase B changes these files when it shouldn't.

**Recommendation**: Remove `docs/superpowers/plans/*.md` from the Phase B rollback step, or reword to: "Phase B rollback: Restore any active docs that were modified; archival files in docs/superpowers/plans/ are not changed and need no restoration."

---

#### Issue 6 — Inventory Conflates docker-compose.yml Image Reference with All Compose Files (Minor)

**Location**: Rename Surface Inventory → deployment row
**Evidence**: The deployment row lists `docker-compose.yml, docker-compose.dev.yml, docker-compose.test.yml, docker-compose.prod.yml` as locations for the image reference `code.klsll.com/havartibard/agent-control-plane:latest`. Verified against actual files: only `docker-compose.prod.yml` line 17 contains this image reference. The base `docker-compose.yml` uses `build: .`, and `docker-compose.dev.yml` uses `image: local/agent-cp-backend:current`.

**Impact**: An operator may look for the image reference in the wrong files during Phase C.

**Recommendation**: Split this into two sub-rows or clarify that the registry image reference is only in `docker-compose.prod.yml`, while `docker-compose.dev.yml` has a separate local image name (`local/agent-cp-backend:current`) that should also be inventoried.

---

### Blocker: Critical Issues Requiring Resolution Before Execution

None identified. The plan is execution-ready with the above corrections. The most significant gap (Issue 2 — ACP ambiguity) carries medium-high risk but does not block execution; it requires an explicit exclusion note to prevent accidental protocol reference renames.

---

### Note: Observations and Follow-Up Items

1. **Root `package.json` has no `"name"` field**: The root `package.json` contains only `"devDependencies": {"tsc": "^2.0.4"}` with no name. The inventory lists it as a rename target for `agent-control-plane` → `primeloop`, but there is nothing to rename. Consider removing this from the inventory or noting it as a no-op.

2. **Database comments in `backend/src/db.ts`**: Lines 658–827 contain multiple "ACP" comments (e.g., `-- ACP (Agentic Control Plane) tables`, `-- ACP tables — migrate legacy tables`). These are developer-facing, not user-facing, and are not listed in the inventory. They fall into a gray area — neither clearly Phase A (user-facing) nor Phase C (operational identifiers). Recommend adding them to Phase B or explicitly deferring them.

3. **`progress.md` contains legacy paths**: The root `progress.md` (a scratch file for a different feature) contains multiple `/home/james/projects/agent-control-plane/...` paths. This is not a rename surface but worth noting — it will show up in any broad search for the old name and could confuse verification.

4. **Historical specs preservation list may be incomplete**: The plan lists 4 historical specs (002, 015, 018, 022) as preserved. There are 23 total specs. A quick search found no "Agent Control Plane" references in other spec files, but the plan should either confirm all other specs were checked or broaden the preservation rule to cover all completed specs (status != draft/in-progress).

5. **`web/src/pages/Setup.tsx` has extensive ACP brand references**: Lines 777, 870, 871, 1538, 1599, 1712, and 1716 all contain "ACP" or "Agent Control Plane" as user-facing text. The inventory covers this under the broad `web/src/**/*.tsx` category but doesn't enumerate these specific lines. For a plan that emphasizes deterministic execution, explicit line-level coverage for the highest-density file would improve operator confidence.

---

### Summary

The plan is **substantially sound and execution-ready**. Phase sequencing, preservation policy, and canonical naming targets are internally consistent and well-grounded in actual repository evidence. The main risks are:

1. **ACP ambiguity** (Issue 2): Without an explicit exclusion for "Agent Client Protocol" references, there is a real risk of incorrect renames in `backend/src/acp/` and related files.
2. **Missing env vars** (Issue 1): Four ACP-prefixed environment variables are not covered by the inventory.
3. **Docker network naming mechanism** (Issue 4): The plan implies compose file edits can rename implicit Docker networks, which is incorrect.

Addressing these three items would elevate the plan from "execution-ready" to "execution-safe."
