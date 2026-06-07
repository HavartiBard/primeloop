# Skill: Agent Catalog Curation

Use this skill when the operator wants to create, provision, or spin up a new agent.

## When to use

- Operator asks to "create an agent", "spin up a specialist", "add an agent for X", or similar.
- A delegation requires a capability not served by any current running agent.
- You want to propose using a registered template for a task rather than ad-hoc delegation.

## Workflow

### Step 1 — List available templates

Call `catalog_list_registered` to see what registered templates exist.
Optionally pass `capability` or `lifecycleIntent` to narrow the list.

```
catalog_list_registered({ capability?: string, lifecycleIntent?: "durable"|"ephemeral" })
→ { templates: [{ templateId, name, version, lifecycleIntent, routingCapabilities, summary }] }
```

### Step 2 — Propose instantiation

Choose the best matching template and call `catalog_propose_instantiation` with the operator's intent.
This is read-only — it produces a rationale and tells you whether human approval is needed.

```
catalog_propose_instantiation({ intent: string, templateId?: string })
→ { templateId, version, rationale, requiresHumanApproval, estimatedGrants }
```

**Always present the rationale to the operator before proceeding.**
If `requiresHumanApproval` is true, tell the operator and wait for confirmation.

### Step 3 — Instantiate (on confirmation)

Only call `catalog_instantiate` after the operator has seen the proposal.

```
catalog_instantiate({ templateId, version?, name? })
→ { status: "active"|"pending_approval"|"blocked", agentId?, approvalId?, message?, code? }
```

Interpret each outcome:

| status | Meaning | What to do |
|--------|---------|------------|
| `active` | Agent created, runtime will provision on demand | Report `agentId` to the operator |
| `pending_approval` | Human approval required | Surface the `approvalId` and ask the operator to approve via the Approvals panel |
| `blocked` | Cannot instantiate | Report the `code` and `detail` clearly; do not retry automatically |

## Constraints (non-negotiable)

- **Never create agents outside the catalog.** Do not write directly to `agents` or use `delegate_to_agent` to bypass this flow.
- **Never widen grants.** The effective grants of any created agent are the intersection of its template declaration and PrimeLoop's runtime policy — this is enforced automatically, but never attempt to work around it.
- **Always propose before instantiating.** Present the rationale and require confirmation for templates that need human approval.
- **Respect `blocked` outcomes.** A `CREDENTIAL_NOT_PROVISIONED` block means the operator must provision the credential first; a `TEMPLATE_DEPRECATED` block means the template cannot be used — suggest finding an alternative.

## Example

```
Operator: "Create a research specialist to investigate our CI failures."

You:
1. catalog_list_registered({ capability: "research" })
   → finds "research-specialist@1.0.0"

2. catalog_propose_instantiation({ intent: "investigate CI failures", templateId: "research-specialist" })
   → rationale: "Selected template 'Research Specialist'. Role: read-only repo analyst.
      This template is eligible for auto-approval."
      requiresHumanApproval: false

3. Present rationale to operator, confirm.

4. catalog_instantiate({ templateId: "research-specialist", name: "CI Investigator" })
   → { status: "active", agentId: "..." }

Report: "Provisioned Research Specialist agent (ID: ...). It will activate when work is delegated to it."
```
