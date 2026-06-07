// Observability and operational ownership for Agent Catalog
//
// Defines metrics, logs, and alerts for catalog operations.
// Operational ownership: Backend team owns catalog schema/store,
// Platform team owns validation/baseline rules.

// Simple console-based logger for catalog operations

// Metrics labels
export const METRIC_LABELS = {
  source: 'catalog_source',
  template_id: 'catalog_template_id',
  version: 'catalog_version',
  admission_state: 'catalog_admission_state',
  actor: 'catalog_actor',
};

// Metric names
export const METRICS = {
  sync_total: 'catalog_sync_total',
  sync_duration_ms: 'catalog_sync_duration_ms',
  validate_total: 'catalog_validate_total',
  validate_duration_ms: 'catalog_validate_duration_ms',
  approve_total: 'catalog_approve_total',
  approve_duration_ms: 'catalog_approve_duration_ms',
  instantiate_total: 'catalog_instantiate_total',
  instantiate_duration_ms: 'catalog_instantiate_duration_ms',
  admission_transitions_total: 'catalog_admission_transitions_total',
};

// Alert definitions
export const ALERTS = {
  high_rejection_rate: {
    name: 'CatalogHighRejectionRate',
    description: 'Template rejection rate exceeds 50% over 1 hour',
    threshold: 0.5,
    window: '1h',
  },
  slow_sync: {
    name: 'CatalogSlowSync',
    description: 'Catalog sync duration exceeds 30 seconds',
    threshold_ms: 30000,
    window: '5m',
  },
  stale_admission_events: {
    name: 'CatalogStaleAdmissionEvents',
    description: 'No admission events in last 24 hours (possible sync failure)',
    threshold_hours: 24,
  },
};

// Log event types
export type LogEvent =
  | { type: 'sync_start'; sourceId?: string }
  | { type: 'sync_complete'; sourceId?: string; count: number; durationMs: number }
  | { type: 'sync_failed'; sourceId?: string; error: string }
  | { type: 'validate_start'; templateId: string; version: string }
  | { type: 'validate_complete'; templateId: string; version: string; state: string; durationMs: number }
  | { type: 'validate_rejected'; templateId: string; version: string; errors: string[] }
  | { type: 'approve_start'; templateId: string; version: string; actor: string }
  | { type: 'approve_complete'; templateId: string; version: string; actor: string; newState: string }
  | { type: 'instantiate_start'; templateId: string; version: string; agentId: string }
  | { type: 'instantiate_complete'; templateId: string; version: string; agentId: string }
  | { type: 'instantiate_failed'; templateId: string; version: string; agentId: string; error: string };

/**
 * Log a catalog event with structured metadata.
 */
export function log(event: LogEvent): void {
  const tag = '[catalog]';
  switch (event.type) {
    case 'sync_start':
      console.log(`${tag} sync started source=${event.sourceId || 'default'}`);
      break;
    case 'sync_complete':
      console.log(`${tag} sync complete source=${event.sourceId || 'default'} count=${event.count} durationMs=${event.durationMs}`);
      break;
    case 'sync_failed':
      console.error(`${tag} sync failed source=${event.sourceId || 'default'} error=${event.error}`);
      break;
    case 'validate_start':
      console.log(`${tag} validate start template=${event.templateId} version=${event.version}`);
      break;
    case 'validate_complete':
      console.log(`${tag} validate complete template=${event.templateId} version=${event.version} state=${event.state} durationMs=${event.durationMs}`);
      break;
    case 'validate_rejected':
      console.warn(`${tag} validate rejected template=${event.templateId} version=${event.version} errors=${JSON.stringify(event.errors)}`);
      break;
    case 'approve_start':
      console.log(`${tag} approve start template=${event.templateId} version=${event.version} actor=${event.actor}`);
      break;
    case 'approve_complete':
      console.log(`${tag} approve complete template=${event.templateId} version=${event.version} actor=${event.actor} newState=${event.newState}`);
      break;
    case 'instantiate_start':
      console.log(`${tag} instantiate start template=${event.templateId} version=${event.version} agentId=${event.agentId}`);
      break;
    case 'instantiate_complete':
      console.log(`${tag} instantiate complete template=${event.templateId} version=${event.version} agentId=${event.agentId}`);
      break;
    case 'instantiate_failed':
      console.error(`${tag} instantiate failed template=${event.templateId} version=${event.version} agentId=${event.agentId} error=${event.error}`);
      break;
  }
}

/**
 * Record an admission state transition metric.
 */
export function recordAdmissionTransition(fromState: string, toState: string): void {
  // TODO: Implement metric recording (Prometheus counter)
  console.log(`[catalog] admission transition from=${fromState} to=${toState}`);
}

/**
 * Record a sync duration metric.
 */
export function recordSyncDuration(sourceId: string | undefined, durationMs: number, count: number): void {
  // TODO: Implement metric recording
  console.log(`[catalog] sync duration source=${sourceId || 'default'} durationMs=${durationMs} count=${count}`);
}
