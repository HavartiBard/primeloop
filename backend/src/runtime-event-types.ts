// Typed runtime-event constants (FR-015)
// New event types for managed-agent runtime alignment

export const RuntimeEventTypes = {
  // Session recovery events (US1)
  SESSION_RESUMED: 'session.resumed',
  DELEGATION_RECOVERED: 'delegation.recovered',
  DELEGATION_RECOVERED_FAILED: 'delegation.recovered_failed',
  
  // Credential broker events (US2)
  CREDENTIAL_ISSUED: 'credential.issued',
  CREDENTIAL_ROTATED: 'credential.rotated',
  CREDENTIAL_REVOKED: 'credential.revoked',
  CREDENTIAL_RISK_FLAGGED: 'credential.risk_flagged',
  
  // Runtime lease events (US3)
  RUNTIME_LEASED: 'runtime.leased',
  RUNTIME_RECLAIMED: 'runtime.reclaimed',
  
  // Egress/FS denial events (US5)
  EGRESS_DENIED: 'egress.denied',
  FS_DENIED: 'fs.denied',
  
  // LLM proxy events (US2 + US5)
  LLM_PROXIED: 'llm.proxied',
  
  // Launcher auth events (US5)
  LAUNCHER_AUTH_DENIED: 'launcher.auth_denied',
} as const

export type RuntimeEventType = typeof RuntimeEventTypes[keyof typeof RuntimeEventTypes]
