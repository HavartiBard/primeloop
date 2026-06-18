// Workspace module: observer.trace
//
// Full production implementation of OpenTelemetry tracing for Prime modules.
// Traces Prime session lifecycle, module execution, and key decisions.
//
// Configuration:
//   OTEL_EXPORTER_OTLP_ENDPOINT - OTLP endpoint URL (e.g., http://localhost:4318/v1/traces)
//   OTEL_SERVICE_NAME - Service name (default: primeloop-backend)
//   OTEL_TRACES_EXPORTER - Exporter type (default: otlp)
//   OTEL_RESOURCE_ATTRIBUTES - Resource attributes (optional)
//
// To enable:
//   1. Install @opentelemetry/* packages: npm install @opentelemetry/sdk-trace-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions
//   2. Configure OTEL_EXPORTER_OTLP_ENDPOINT in .env
//   3. Restart backend

import type { PrimeModule, PrimeLoopState, PrimeModuleDeps, PrimeModuleResult } from '../../../src/prime-agent/modules/types.js';

interface TracerState {
  initialized: boolean;
  tracer: any | null;
  provider: any | null;
  error?: string;
}

const tracerState: TracerState = {
  initialized: false,
  tracer: null,
  provider: null,
};

export const OBSERVER_TRACE_MODULE: PrimeModule = {
  id: 'observer.trace',
  stage: 'observer',
  version: '2.0.0-workspace',
  requires_active: false,
  order: 900, // Run last in observer stage
  
  async run(state: PrimeLoopState, deps: PrimeModuleDeps): Promise<PrimeModuleResult> {
    // Initialize tracer on first run if not already done
    if (!tracerState.initialized) {
      await initializeTracer();
      tracerState.initialized = true;
    }

    if (!tracerState.tracer) {
      return { detail: 'tracing disabled (OTel not configured or failed to initialize)' };
    }

    try {
      // Create a trace span for this Prime session
      const span = tracerState.tracer.startSpan(`prime.session.${state.event.type}`, {
        attributes: {
          'prime.session_id': state.session.id,
          'prime.event_type': state.event.type,
          'prime.trigger_type': getTriggerType(state.event),
          'prime.workspace_root': state.session.workspace_root || '',
          'prime.workspace_revision': state.session.workspace_revision || '',
        },
      });

      // Add module execution as events
      for (const moduleRun of state.moduleRuns) {
        span.addEvent(`module.${moduleRun.id}.${moduleRun.status}`, {
          stage: moduleRun.stage,
          version: moduleRun.version,
          mode: moduleRun.mode,
          detail: moduleRun.detail ?? null,
          started_at: moduleRun.started_at,
          completed_at: moduleRun.completed_at,
        });
      }

      // Add budget information
      span.setAttribute('prime.budget.llm_calls', state.budget.llmCalls);
      span.setAttribute('prime.budget.actions_dispatched', state.budget.actionsDispatched);

      // Add decision information if available
      if (state.decision) {
        span.addEvent('decision.completed', {
          reasoning_length: state.decision.reasoning?.length ?? 0,
          actions_count: state.decision.actions.length,
          provider_used: state.decision.provider_used ?? null,
          model_used: state.decision.model_used ?? null,
          token_count: state.decision.token_count ?? 0,
        });
      }

      // Add context information if available
      if (state.context) {
        span.addEvent('context.assembled', {
          agents_count: state.context.fleet.agents.length,
          dispatchable_agents_count: state.context.runtimeTruth?.dispatchableAgents.length ?? 0,
        });
      }

      // Record errors in diagnostics
      for (const diagnostic of state.diagnostics) {
        if (/error|fail|blocked/i.test(diagnostic)) {
          span.addEvent('diagnostic', {
            level: 'warning',
            message: diagnostic,
          });
        }
      }

      // Set span status based on module runs
      const hasFailures = state.moduleRuns.some(m => m.status === 'failed');
      if (hasFailures) {
        span.setStatus({ code: 2 }); // ERROR
      } else {
        span.setStatus({ code: 1 }); // OK
      }

      span.end();

      return { 
        detail: `traced ${state.moduleRuns.length} module executions, status=${hasFailures ? 'error' : 'ok'}` 
      };
    } catch (err) {
      // Don't throw - tracing errors should not break the Prime loop
      console.error('[observer.trace] Span creation failed:', err);
      return { detail: 'tracing failed' };
    }
  },
};

async function initializeTracer(): Promise<void> {
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  
  if (!otlpEndpoint) {
    console.log('[observer.trace] OTEL_EXPORTER_OTLP_ENDPOINT not set, tracing disabled');
    tracerState.error = 'OTEL_EXPORTER_OTLP_ENDPOINT not configured';
    return;
  }

  try {
    // Dynamically import OTel packages (they're optional dependencies)
    const NodeTracerProvider = (await import('@opentelemetry/sdk-trace-node')).NodeTracerProvider;
    const SimpleSpanProcessor = (await import('@opentelemetry/sdk-trace-base')).SimpleSpanProcessor;
    const OTLPTraceExporter = (await import('@opentelemetry/exporter-trace-otlp-http')).OTLPTraceExporter;
    const { Resource } = await import('@opentelemetry/resources');
    const { SemanticResourceAttributes } = await import('@opentelemetry/semantic-conventions');

    const serviceName = process.env.OTEL_SERVICE_NAME || 'primeloop-backend';
    const resourceAttributes: Record<string, string> = {
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
      [SemanticResourceAttributes.SERVICE_NAMESPACE]: 'primeloop',
    };

    // Add custom resource attributes if configured
    const customAttrs = process.env.OTEL_RESOURCE_ATTRIBUTES;
    if (customAttrs) {
      for (const attr of customAttrs.split(',')) {
        const [key, value] = attr.split('=');
        if (key && value) {
          resourceAttributes[key.trim()] = value.trim();
        }
      }
    }

    const provider = new NodeTracerProvider({
      resource: new Resource(resourceAttributes),
    });

    const exporter = new OTLPTraceExporter({
      url: otlpEndpoint,
    });

    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
    provider.register();

    // Store tracer instance
    const api = await import('@opentelemetry/api');
    tracerState.tracer = api.trace.getTracer('primeloop-modules', '2.0.0');
    tracerState.provider = provider;

    console.log(`[observer.trace] Initialized OTLP exporter to ${otlpEndpoint}, service=${serviceName}`);
  } catch (err) {
    const message = (err as Error).message;
    console.warn('[observer.trace] Failed to initialize OTel:', message);
    tracerState.error = message;
    
    // Check if packages are installed
    try {
      await import('@opentelemetry/api');
      console.log('[observer.trace] @opentelemetry/api is installed, but other packages may be missing');
    } catch {
      console.log('[observer.trace] Install @opentelemetry/* packages to enable tracing:');
      console.log('  npm install @opentelemetry/sdk-trace-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions');
    }
  }
}

function getTriggerType(event: any): string {
  switch (event.type) {
    case 'prime.message':
      return 'prime_message';
    case 'cron.fast':
      return 'cron_fast';
    case 'fleet.delegation.completed':
    case 'fleet.delegation.failed':
      return 'fleet_result';
    case 'goal.created':
      return 'goal';
    default:
      return event.type || 'unknown';
  }
}

// Default export for module loader
export default OBSERVER_TRACE_MODULE;
