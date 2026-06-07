# Contract: Orchestrator (Prime) Catalog Skill

> **Implementation status: ⬜ planned (US4).** Not yet implemented — this is the design contract for the orchestrator skill phase.

Lets Prime curate and instantiate agents from registered templates. Exposed as control-plane tools through the existing `mcp/service.ts` `listControlPlaneTools` mechanism (same surface Prime already uses), plus a skill prompt describing curation behavior. Instantiation always routes through the template's approval policy and the existing approval queue; Prime can never widen authority beyond the declaration (FR-029/FR-030).

## Control-plane tools

### `catalog.list_registered`
List registered (non-deprecated) templates Prime may instantiate.
- Input: `{ capability?: string, lifecycleIntent?: 'durable'|'ephemeral' }`
- Output: `{ templates: [{ templateId, name, version, routingCapabilities, summary }] }`

### `catalog.propose_instantiation`
Produce a human-readable proposal (no side effects) selecting a template for an intent.
- Input: `{ intent: string, templateId?: string }`
- Output: `{ templateId, version, rationale, requiresHumanApproval: boolean, estimatedGrants: { primitives, bundles, mcp, credentials } }`
- `requiresHumanApproval` is true whenever grants exceed the safe baseline (R5).

### `catalog.instantiate`
Request instantiation of a registered template.
- Input: `{ templateId, version?, name? }`
- Behavior:
  - If approval policy requires human approval (default, or grants exceed safe baseline) → creates an approval-queue item and returns `{ status: 'pending_approval', approvalId }`. **No agent is created yet.**
  - If safe-baseline auto-approval applies → instantiates and returns `{ status: 'active', agentId }`.
  - If a declared credential is not provisioned → `{ status: 'blocked', code: 'CREDENTIAL_NOT_PROVISIONED' }`.
- Output: one of the above. Effective grants never exceed the declaration.

## Skill prompt (behavioral contract)

The skill instructs Prime to:
1. Map an operator intent to the best registered template via `catalog.list_registered` (match on `routingCapabilities`/lifecycle).
2. Call `catalog.propose_instantiation` and present the rationale to the operator.
3. Only on confirmation, call `catalog.instantiate`; surface `pending_approval` / `blocked` outcomes plainly rather than retrying.
4. Never attempt to create agents outside the catalog or to widen grants.

## Invariants

- Prime acts only through these tools; no direct DB writes to catalog/agent tables.
- Every proposal/instantiation is recorded as a `catalog_admission_events` entry with `actor: 'prime'`.
- Approval routing reuses the approval queue (008); the stricter of (declared policy, runtime policy) wins.
