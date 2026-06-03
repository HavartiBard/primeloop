# Quickstart: PrimeLoop Repo Rename Execution

Use this guide to execute and verify the staged rename defined by `plan.md`.

## Prerequisites

- Work from branch `023-repo-rename-plan` or the eventual implementation branch derived from it.
- Keep the rename scoped to repository-controlled surfaces first.
- Treat external systems (registries, hosted remotes, bookmarks, docs sites) as manual follow-ups.

## Classification Rules

When evaluating rename surfaces, use these rules:
- **Immediate PrimeLoop branding target**: Public-facing text in active docs, README, product copy
- **Deferred operational identifier**: Machine identifiers (package names, image names) that can be staged for compatibility
- **Preserved historical/archive reference**: Completed specs, archived notes, historical records where traceability matters
- **External/manual follow-up**: Git remotes, container registries, CI variables, dashboard labels not in-repo

## 1. Capture the current inventory baseline

Run a repository search for the legacy name family before editing:

```sh
rg -n "agent-control-plane|Agent Control Plane|\bACP\b" . \
  --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!build'
```

Review the results and classify each hit into one of:
- immediate PrimeLoop branding target
- deferred operational identifier
- preserved historical/archive reference
- external/manual follow-up note

## 2. Apply Phase A — public branding and repository-facing names

Update repository-controlled, public-facing surfaces first:
- `README.md`
- active product/descriptive copy in `web/`
- active docs and plan/spec references that describe the current product
- repository-facing naming that should visibly become PrimeLoop

Verify:
- PrimeLoop is the only public-facing product name in changed active surfaces
- Prime still appears only as an internal coordinator/runtime concept where intended

## 3. Apply Phase B — active docs and cleanup

Normalize active documentation and remove mixed-brand wording from current-facing material while
preserving archival records.

Do **not** rewrite completed historical specs or archived notes unless you have explicitly decided
traceability is not needed.

Verify:
- updated active docs consistently say PrimeLoop
- preserved historical references are clearly archival rather than accidental leftovers

## 4. Apply Phase C — operational identifiers

Review high-risk machine identifiers and decide which move now versus later:
- package names and lockfiles (`rg -n '"name"|agent-control-plane|agent-control-plane-web|agent-control-plane-backend' package-lock.json backend/package.json backend/package-lock.json web/package.json web/package-lock.json`)
- Docker image names and network naming assumptions (`rg "agent-control-plane|agent-cp" docker-compose*.yml`)
- shell scripts and repo-root validation messages (`rg "agent-control-plane|agent-cp|ACP_" scripts/`)
- backend/frontend strings that affect tooling or integration behavior

Important: do **not** rename `ACP` references that mean **Agent Client Protocol**. Protocol references in files such as `backend/src/acp/` are technical identifiers, not product-branding surfaces.

For each operational identifier:
1. Check compatibility expectations in `plan.md` Phase C
2. Apply rename or mark as staged-legacy with a comment explaining the delay
3. Run verification:

```sh
# Package manifest / lockfile identity check
rg -n '"name"|agent-control-plane|agent-control-plane-web|agent-control-plane-backend' \
  package-lock.json backend/package.json backend/package-lock.json web/package.json web/package-lock.json

# Docker build / compose config test (if changed)
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml config

# Script execution test
bash scripts/dev-up.sh --dry-run 2>&1 | grep -E "(error|Error|ERROR)" || echo "No errors detected"
```

Verify:
- every legacy operational identifier left in place has an explicit staged-migration reason in a comment or migration note
- no script or deployment path was changed without considering compatibility impact
- if Docker network naming depends on the repository/directory name, the migration notes explicitly state whether the rollout will use a renamed project directory or `docker compose -p primeloop`

## 5. Apply Phase D — external manual follow-ups

Create a checklist (or use the template below) for external systems:

```markdown
### External Manual Follow-ups Checklist

- [ ] Git remote renamed from `agent-control-plane` to `primeloop`
- [ ] Container registry image tags updated in all deployment manifests
- [ ] Local clones updated with new remote URLs
- [ ] Shell aliases updated with new paths
- [ ] CI/CD environment variables updated
- [ ] Monitoring/alerting dashboard labels updated
- [ ] Documentation site URL structure updated

**Note**: These systems are not in-repo. Check each item manually after completing Phase C.
```

Verify:
- no third-party dependency is implied to be complete unless manually checked off
- all checked items have operator initials and date recorded

## 6. Final verification

Re-run the repository search and confirm every remaining legacy hit is either:
- intentionally preserved historical content (check against inventory table in plan.md)
- an explicitly deferred operational identifier with a staged-migration comment
- an external follow-up item on the manual checklist

```sh
rg -n "agent-control-plane|Agent Control Plane|\bACP\b" . \
  --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!build'
```

**Success criteria**:
- All active current-facing references use PrimeLoop (no ACP or "Agent Control Plane" in README, web/index.html, active docs)
- Prime appears only in internal runtime/coordinator contexts where intended
- Remaining old-name hits are explained by classification rules or external checklist items
- No unexplained legacy references remain in repository-controlled surfaces
