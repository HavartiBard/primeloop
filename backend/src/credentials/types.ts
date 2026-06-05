// Credential types for the broker (FR-007 – FR-011)

export type CredentialKind =
  | 'provider_proxy_token'   // authorizes calling the LLM proxy (FR-008)
  | 'gitea_token'            // derived/scoped (FR-011)
  | 'named_secret'           // operator-defined (FR-011)
  | 'launcher_token'         // authenticates the backend→launcher socket

export interface NamedSecretSpec {
  envName: string
  value: string
}

export interface AgentScope {
  namedSecrets?: NamedSecretSpec[]
  controlPlaneTokenEnvName?: string
  providerIds?: string[]
  providerTypes?: string[]
  [key: string]: unknown
}

export interface IssuedCredential {
  id: string
  kind: CredentialKind
  envVars: Record<string, string>   // injected into process env ONLY (never files)
  expiresAt: string
  autoRotatable: boolean
}

export interface CredentialRecord {
  id: string
  agent_id: string
  kind: CredentialKind
  scope: Record<string, unknown>
  secret_ref: string
  status: 'active' | 'rotating' | 'revoked' | 'risky'
  auto_rotatable: boolean
  issued_at: string
  expires_at?: string
  rotated_at?: string
  revoked_at?: string
}
