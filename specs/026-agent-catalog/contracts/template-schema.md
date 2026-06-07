# Contract: Catalog Template File Schema (YAML)

The authoring contract for an agent template. One template per YAML file in a catalog source. Field names are the contract; `catalog/schema.ts` enforces required/optional structure and `catalog/validator.ts` enforces semantics. This doc is reconciled to the **implemented** schema (flat fields, `string[]` for deny/credential lists).

## Required fields

`catalog/schema.ts` `REQUIRED_FIELDS`:

| Field | Type | Description |
|-------|------|-------------|
| `templateId` | string | Stable, durable identifier (slug). Unique within the catalog. |
| `name` | string | Human-readable display name. |
| `version` | string | Author-supplied version (semver recommended). Immutable once registered. |
| `agentType` | string | Agent type. |
| `runtimeFamily` | string | Runtime family (e.g. `opencode`, `acp`). |
| `lifecycleIntent` | enum | `durable` \| `ephemeral`. |
| `capabilityProfile` | object | The declared powers (see below). |

## Optional fields

The complete agent definition is carried via these (system prompt / soul / persona may be inline **or** referenced by a sibling `*File` path; file refs are resolved into the frozen snapshot at registration):

| Field | Type | Description |
|-------|------|-------------|
| `systemPrompt` | string | Inline system prompt. |
| `systemPromptFile` | string | Path to a system-prompt file in the catalog (alternative to inline). |
| `soul` | string | Inline soul. |
| `soulFile` | string | Path to a soul file. |
| `persona` | string | Inline persona. |
| `personaFile` | string | Path to a persona file. |
| `toolAccess` | string[] | Tools the agent may use (bounded by the capability profile). |
| `mcpAccess` | string[] | MCP server names (must exist in `mcp_servers`). |
| `credentialNeeds` | string[] | Named brokered credentials required. **No secret values.** |
| `runtimeRequirements` | object | Runtime bounds (see below). |
| `approvalPolicy` | object | `{ autoEligible?: boolean }` — auto-approval is honored only if grants are within the safe baseline; otherwise forced to human approval. |
| `routing` | object | `{ preferredRole?: string, workClass?: string }` for Prime dispatch. |

### `capabilityProfile` (required object)
| Field | Type | Description |
|-------|------|-------------|
| `platformPrimitives` | string[] | Declared platform primitives (validated against the real primitive set — see `catalog/primitives.ts`). |
| `capabilityBundles` | string[] | Declared capability bundles (validated against `capability_bundle_adapters`). |
| `denyRules` | string[] | Explicit deny entries. |

### `runtimeRequirements` (optional object)
| Field | Type | Description |
|-------|------|-------------|
| `limits` | object | `{ maxTokens?, maxMemoryMB? }`. |
| `filesystemScope` | object | `{ read?: string[], write?: string[] }`. |
| `egress` | object | `{ allowlist?: string[] }` (default-deny). |

> **Note:** `provenance` (source / commitSha / sourcePath / sourceRef / version) is **system-populated** at sync/registration time and is not an authored field.

## Example

```yaml
templateId: research-specialist
name: Research Specialist
version: 1.0.0
agentType: research-specialist
runtimeFamily: opencode
lifecycleIntent: ephemeral
soul: "Methodical researcher. Reads broadly, cites precisely, never writes."
systemPromptFile: ./prompts/research-specialist.system.md
personaFile: ./prompts/research-specialist.persona.md
capabilityProfile:
  platformPrimitives: [update_work_item, soul.read, memory.read]
  capabilityBundles: [repo.read]
  denyRules: [repo.write]
toolAccess: [grep, read]
mcpAccess: [hister]
runtimeRequirements:
  limits: { maxTokens: 30000, maxMemoryMB: 512 }
  filesystemScope: { read: ["."], write: [] }
  egress: { allowlist: [] }
approvalPolicy:
  autoEligible: true   # honored only because grants are read-only & within the safe baseline
routing:
  preferredRole: research
```

## Validation contract (summary)

- Missing any required field → `MISSING_REQUIRED_FIELD`; wrong shape → `INVALID_FIELD_TYPE` (rejected, not approvable).
- Unknown bundle / primitive / MCP / credential → corresponding `UNKNOWN_*` (rejected).
- `toolAccess`/`mcpAccess` exceeding what the capability profile enables → `LEAST_PRIVILEGE_VIOLATION` (rejected). Declaring `credentialNeeds` is **not** itself a violation; provisioning is checked at instantiation.
- Real secret *values* (PEM blocks, `sk-…`, `AKIA…`, high-entropy strings, `key:/password=` assignments) in prompt/soul/persona → `SECRET_VALUE_PRESENT` (rejected). Merely mentioning words like "password" is not flagged.
- `autoEligible: true` but grants exceed the safe baseline → `APPROVAL_POLICY_DOWNGRADED` — a **warning**, not a rejection: the template is validated but forced to human approval.
- `VERSION_CONFLICT` — the same `templateId@version` appears twice (or is reused with different content); `DUPLICATE_TEMPLATE_ID` — same `templateId` twice in a batch.

`validateTemplate(yamlContent, context)` returns `{ errors: FailureReason[]; warnings: FailureReason[] }`; an entry is rejected only when `errors` is non-empty.
