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
  
  // Launcher runtime events (US1, US2)
  RUNTIME_LAUNCHER_STATUS: 'launcher.runtime_status',
  RUNTIME_LAUNCHER_PROVISION: 'launcher.runtime_provision',
  RUNTIME_LAUNCHER_RESTART: 'launcher.runtime_restart',
  RUNTIME_LAUNCHER_TEARDOWN: 'launcher.runtime_teardown',
  RUNTIME_LAUNCHER_RECOVERY: 'launcher.runtime_recovery',

  // Runtime-mode rollout/rollback events (spec 025 US3)
  RUNTIME_MODE_ACTIVE: 'runtime.mode_active',
  RUNTIME_MODE_ROLLOUT_VALIDATED: 'runtime.mode_rollout_validated',
  RUNTIME_MODE_ROLLOUT_BLOCKED: 'runtime.mode_rollout_blocked',
  RUNTIME_MODE_ROLLBACK: 'runtime.mode_rollback',
} as const

export type RuntimeEventType = typeof RuntimeEventTypes[keyof typeof RuntimeEventTypes]
