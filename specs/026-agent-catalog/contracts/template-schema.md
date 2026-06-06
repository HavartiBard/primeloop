# Contract: Catalog Template File Schema (YAML)

The authoring contract for an agent template. One template per YAML file in a catalog source. Field names are the contract; `catalog/schema.ts` enforces required/optional and `catalog/validator.ts` enforces semantics.

## Required fields

| Field | Type | Description |
|-------|------|-------------|
| `apiVersion` | string | Schema version, e.g. `catalog/v1`. Enables future migration. |
| `id` | string | Stable, durable identifier (slug). Unique within the catalog. |
| `name` | string | Human-readable display name. |
| `version` | string | Author-supplied version (semver recommended). Immutable once registered. |
| `agentType` | string | Runtime family / type (must be a known runtime family). |
| `lifecycleIntent` | enum | `durable` \| `ephemeral`. |
| `definition.systemPrompt` | string \| `{ file: <path> }` | Full system prompt, inline or file reference. |
| `definition.soul` | string \| `{ file: <path> }` | Soul definition, inline or file reference. |
| `definition.persona` | string \| `{ file: <path> }` | Persona content, inline or file reference. |
| `capabilityProfile.platformPrimitives` | string[] | Declared platform primitives. |
| `capabilityProfile.capabilityBundles` | string[] | Declared capability bundles. |
| `runtimeRequirements` | object | See below; runtime bounds the agent must run within. |
| `approvalPolicy` | object | See below. |

### `runtimeRequirements` (required object)
| Field | Type | Req | Description |
|-------|------|-----|-------------|
| `limits` | object | yes | e.g. `{ maxTokens, maxDurationMs, maxConcurrentProcesses }`. |
| `filesystemScope` | string | yes | Working-dir scope (default-deny outside). |
| `egressAllowlist` | string[] | yes | Allowed outbound hosts (default-deny; empty = none). |
| `trustZone` | string | no | Defaults to `local`. |

### `approvalPolicy` (required object)
| Field | Type | Req | Description |
|-------|------|-----|-------------|
| `default` | enum | yes | `human` (default) \| `auto`. |
| `autoEligible` | boolean | no | If true, auto-approval is *requested* — honored only within the safe baseline. |

## Optional fields

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Notes/summary. |
| `metadata` | object | Tags, owner, etc. |
| `capabilityProfile.denyRules` | object[] | Explicit deny rules (e.g. block a primitive/bundle). |
| `toolAccess` | string[] / object[] | Tools the agent may use (bounded by the capability profile). |
| `mcpAccess` | string[] | MCP server names (must exist in `mcp_servers`). |
| `credentialNeeds` | object[] | `{ name, scope? }` named brokered credentials. **No secret values.** |
| `routing` | object | `{ capabilities: string[], role?: string }` for Prime dispatch. |
| `source` | object | `{ repo, ref, path }` provenance when published to Git (omitted for local-only). |

## Example

```yaml
apiVersion: catalog/v1
id: research-specialist
name: Research Specialist
version: 1.0.0
agentType: opencode
lifecycleIntent: ephemeral
description: Read-only repository research with one MCP server.
definition:
  systemPrompt: { file: ./prompts/research-specialist.system.md }
  soul: "Methodical researcher. Reads broadly, cites precisely, never writes."
  persona: { file: ./prompts/research-specialist.persona.md }
capabilityProfile:
  platformPrimitives: [update_work_item, soul.read, memory.read]
  capabilityBundles: [repo.read]
  denyRules:
    - { kind: bundle, bundle: repo.write, reason: read-only researcher }
toolAccess: [grep, read, web.search]
mcpAccess: [hister]
runtimeRequirements:
  limits: { maxTokens: 30000, maxDurationMs: 180000, maxConcurrentProcesses: 1 }
  filesystemScope: workdir
  egressAllowlist: []
approvalPolicy:
  default: human
  autoEligible: true   # honored only because grants are read-only & within safe baseline
routing:
  capabilities: [research]
```

## Validation contract (summary)

- Missing any required field → `MISSING_REQUIRED_FIELD` (rejected, not approvable).
- Unknown bundle/primitive/MCP/credential/provider → corresponding `UNKNOWN_*` (rejected).
- `toolAccess`/`mcpAccess`/`credentialNeeds` exceeding the capability profile → `LEAST_PRIVILEGE_VIOLATION` (rejected).
- Inline secret in `credentialNeeds` or elsewhere → `SECRET_VALUE_PRESENT` (rejected).
- `autoEligible: true` but grants exceed the safe baseline → `APPROVAL_POLICY_DOWNGRADED` (warning; forced to human approval, not rejected).
