# Phase 1 Data Model: PrimeLoop Repo Rename Plan

## Overview

This feature models the repository rename as a set of tracked rename surfaces grouped into ordered
phases, with explicit distinction between immediate public-brand updates, deferred compatibility
surfaces, preserved historical references, and manual external follow-ups.

## Entities

### Rename Surface

A file, identifier, asset, or user-visible label that currently uses the old name and requires one
of four outcomes: update now, update later, preserve, or track externally.

| Field | Type | Description |
|---|---|---|
| `category` | enum | One of `repo-metadata`, `docs`, `product-copy`, `package-metadata`, `deployment`, `script`, `backend-string`, `frontend-string`, `historical`, `external-followup` |
| `location` | string | File path, artifact reference, or external system label |
| `currentValue` | string | Current old-name value or phrase |
| `targetValue` | string or null | PrimeLoop-era replacement if updated; null when preserved |
| `phase` | enum | One of `phase-a-brand`, `phase-b-docs`, `phase-c-operational`, `phase-d-external`, `preserved-history` |
| `ownership` | enum | `repo-controlled` or `operator-managed` |
| `compatibilityMode` | enum | `immediate`, `staged-legacy`, `preserve`, `manual-followup` |
| `riskLevel` | enum | `low`, `medium`, `high` based on workflow breakage risk |
| `verificationMethod` | string | How the operator proves the surface is handled correctly |

**Validation rules**:
- `targetValue` is required unless `compatibilityMode` is `preserve`.
- `ownership = repo-controlled` requires a concrete `phase` other than `phase-d-external`.
- `compatibilityMode = staged-legacy` requires a later migration phase or explicit rationale.

### Naming Target

A canonical mapping that defines how a class of names should appear after the rename.

| Field | Type | Description |
|---|---|---|
| `surfaceType` | enum | `public-brand`, `repo-slug`, `package-name`, `image-name`, `network-name`, `ui-copy`, `internal-prime-term` |
| `format` | string | Target naming pattern such as `PrimeLoop` or `primeloop-backend` |
| `canonicalStatus` | enum | `public-canonical`, `internal-only`, `legacy-temporary` |
| `notes` | string | Scope or exceptions for this target |

### Rename Phase

An ordered unit of execution that groups related rename surfaces and defines the conditions for
moving forward safely.

| Field | Type | Description |
|---|---|---|
| `id` | enum | `phase-a-brand`, `phase-b-docs`, `phase-c-operational`, `phase-d-external` |
| `goal` | string | Outcome the phase must achieve |
| `includedCategories` | list | Rename surface categories handled in the phase |
| `dependencies` | list | Prior phases or assumptions required first |
| `completionCheck` | string | Verification signal for phase completion |
| `rollbackSensitivity` | string | Notes about operator risk if the phase is incomplete |

### External Follow-Up

A manual action outside direct repository control that must be tracked for full rename completion.

| Field | Type | Description |
|---|---|---|
| `system` | string | Registry, hosting platform, bookmarks, docs site, or other external dependency |
| `action` | string | Manual rename or update needed |
| `blocking` | boolean | Whether the action blocks rollout or can happen later |
| `evidence` | string | What confirms the follow-up is complete |

## Relationships

- A **Rename Phase** contains many **Rename Surfaces**.
- A **Rename Surface** may reference one **Naming Target**.
- An **External Follow-Up** may be derived from one or more **Rename Surfaces** with
  `ownership = operator-managed`.

## Lifecycle / State Transitions

### Rename Surface lifecycle

```text
Discovered -> Classified -> Assigned to phase -> Updated or Preserved -> Verified
```

Variant paths:
- `Classified -> Preserved -> Verified` for historical/archive references
- `Assigned to phase -> Staged legacy -> Migrated later -> Verified` for operational identifiers
- `Classified -> External follow-up -> Manually completed -> Verified` for third-party systems

### Rename Phase lifecycle

```text
Planned -> In Progress -> Verified -> Closed
```

A phase cannot close until every included rename surface is either:
- updated and verified,
- explicitly preserved with rationale, or
- moved to the manual external follow-up list when operator-managed.

## Scale Assumptions

- The number of repository-controlled rename surfaces is modest enough to inventory explicitly in
  documentation.
- The highest-risk surfaces are concentrated in package metadata, Docker/image/network identifiers,
  shell scripts, and active product copy.
- Third-party follow-ups are expected to be a smaller list than repository-controlled surfaces and
  do not require deep environment-specific branching in the plan.
