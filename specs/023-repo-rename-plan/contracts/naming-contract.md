# Naming Contract: PrimeLoop Repo Rename

## Purpose

Define the canonical naming outcomes for the PrimeLoop rename so repository-controlled changes stay
consistent and staged compatibility remains explicit.

## Canonical Naming Rules

| Surface Type | Canonical Target | Policy |
|---|---|---|
| Public product name | `PrimeLoop` | Required for active docs, repo identity, and user-facing product copy |
| Internal coordinator concept | `Prime` | Allowed only for internal runtime/agent concepts, not as a parallel public brand |
| Repo slug family | `primeloop` | Preferred machine-readable slug for repo-level naming |
| Multi-part package/image names | `primeloop-*` | Preferred long-term machine identifier pattern |
| Historical/archive references | Preserve existing text | Allowed when needed for traceability; must not be mistaken for current branding |
| External third-party follow-ups | Manual action list | Must be tracked, but not expanded into full in-repo execution runbooks |

## Staged Migration Contract

### Phase A — Immediate rename targets

The following surfaces should move to PrimeLoop first:
- repository title and descriptive headings
- active documentation introducing or describing the product
- user-facing UI labels and product copy
- plan/spec language for current-facing work

### Phase B — Operational compatibility surfaces

The following may remain temporarily on legacy identifiers if changing them immediately would risk
workflow breakage:
- npm package names and lockfile package identities
- Docker image names and Docker network names
- shell-script references to repo/container names
- backend protocol client/server identity strings where compatibility matters more than branding

Each deferred operational identifier must have one of:
1. a later migration phase, or
2. an explicit reason it will remain legacy for now.

## Preservation Rules

| Surface Class | Rule |
|---|---|
| Completed historical specs | Preserve as written unless traceability risk is waived |
| Archived notes or immutable records | Preserve as written |
| Active docs | Update to PrimeLoop |
| Current-facing product copy | Update to PrimeLoop |

## Verification Contract

A rename phase is complete only when:
1. all in-scope repository-controlled rename surfaces for that phase are updated or explicitly
   preserved,
2. PrimeLoop is the only public-facing product name in updated active surfaces,
3. any remaining legacy operational identifiers are called out as staged compatibility surfaces, and
4. external systems are listed in a manual follow-up section rather than silently omitted.
