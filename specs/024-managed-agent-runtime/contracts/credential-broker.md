# Contract: CredentialBroker (FR-007 – FR-011)

Issues short-lived scoped credentials; never writes secret values to disk.

```ts
type CredentialKind = 'provider_proxy_token' | 'gitea_token' | 'named_secret'

interface IssuedCredential {
  id: string
  kind: CredentialKind
  envVars: Record<string, string>   // injected into process env ONLY (never files)
  expiresAt: string
  autoRotatable: boolean
}

interface CredentialBroker {
  issueForAgent(agentId: string, scope: AgentScope): Promise<IssuedCredential[]>
  rotate(credentialId: string): Promise<IssuedCredential>     // no agent restart
  revoke(credentialId: string): Promise<void>                  // sync for ephemerals
  revokeAllForAgent(agentId: string): Promise<void>            // teardown
}
```

**Rules**
- `issueForAgent` returns env vars only; `process-manager` injects them at spawn and
  MUST NOT write them to `opencode.json`, `AGENTS.md`, or any worktree file (FR-009 /
  SC-002).
- Scopable upstreams (Gitea, named secrets) → derived/scoped token. Un-scopable
  provider keys → a `provider_proxy_token` authorizing the LLM proxy (see
  `llm-proxy.md`); the raw provider key is never issued (FR-008).
- Durable agents: a `node-cron` rotation job rotates before `expiresAt` (≤24h TTL). If
  `autoRotatable=false` or TTL exceeded → set status `risky` and emit
  `credential.risk_flagged` (FR-010).
- Teardown: `revokeAllForAgent` runs synchronously for ephemerals (FR-007); emits
  `credential.revoked`.
- Master secrets read via existing `crypto.ts` / `SECRET_ENCRYPTION_KEY`; broker stores
  only metadata in `brokered_credentials`.
