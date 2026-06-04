// Flag-gated credential lifecycle for managed agents (US2, FR-007).
// Behind CREDENTIAL_BROKER: issue brokered credentials at provision and revoke them
// synchronously at teardown. Returns env vars to inject into the agent process — never
// written to disk (FR-009).

import type { CredentialBroker } from './broker.js'
import type { AgentScope } from './types.js'

export async function provisionAgentCredentials(
  broker: CredentialBroker,
  agentId: string,
  scope: AgentScope,
  enabled: boolean
): Promise<Record<string, string>> {
  if (!enabled) return {}
  // Re-provision is idempotent: revoke any prior creds, then issue a fresh set.
  await broker.revokeAllForAgent(agentId)
  const issued = await broker.issueForAgent(agentId, scope)
  return Object.assign({}, ...issued.map((c) => c.envVars))
}

export async function revokeAgentCredentials(
  broker: CredentialBroker,
  agentId: string,
  enabled: boolean
): Promise<void> {
  if (!enabled) return
  await broker.revokeAllForAgent(agentId)
}
