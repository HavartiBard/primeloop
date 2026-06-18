// Workspace module: observer.trace
//
// Adds OpenTelemetry tracing for Prime module execution.
// This is a new module that doesn't override any built-in — it adds
// additional observability to the Prime loop.
//
// To enable:
// 1. Ensure workspace/modules/observer/trace.ts exists
// 2. Configure OTEL_EXPORTER_OTLP_ENDPOINT in .env
// 3. The module will automatically start tracing

import type { PrimeModule, PrimeLoopState, PrimeModuleDeps, PrimeModuleResult } from '../../../src/prime-agent/modules/types.js';

let tracer: any = null;
let initialized = false;

export const OBSERVER_TRACE_MODULE: PrimeModule = {
  id: 'observer.trace',
  stage: 'observer',
  version: '1.0.0-workspace',
  requires_active: false,
  order: 900, // Run last in observer stage
  
  async run(state: PrimeLoopState, deps: PrimeModuleDeps): Promise<PrimeModuleResult> {
    // Initialize tracer on first run if not already done
    if (!initialized) {
      await initializeTracer();
      initialized = true;
    }

    if (!tracer) {
      return { detail: 'tracing disabled (OTEL not configured)' };
    }

    // Create a trace span for this Prime session
    const span = tracer.startSpan(`prime.session.${state.event.type}`, {
      attributes: {
        'prime.session_id': state.session.id,
        'prime.event_type': state.event.type,
        'prime.modules_executed': state.moduleRuns.length,
        'prime.budget.llm_calls': state.budget.llmCalls,
        'prime.budget.actions_dispatched': state.budget.actionsDispatched,
      },
    });

    try {
      // Record module execution as events
      for (const moduleRun of state.moduleRuns) {
        span.addEvent(`module.${moduleRun.id}.${moduleRun.status}`, {
          stage: moduleRun.stage,
          version: moduleRun.version,
          mode: moduleRun.mode,
          detail: moduleRun.detail ?? null,
        });
      }

      // Record session outcome
      const status = state.moduleRuns.some(m => m.status === 'failed') ? 'failed' : 'completed';
      span.setStatus({ code: status === 'completed' ? 1 : 2 }); // 1=OK, 2=ERROR
      
      span.end();
      
      return { detail: `traced ${state.moduleRuns.length} module executions` };
    } catch (err) {
      span.recordException(err as Error);
      span.end();
      throw err;
    }
  },
};

async function initializeTracer(): Promise<void> {
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  
  if (!otlpEndpoint) {
    console.log('[observer.trace] OTEL_EXPORTER_OTLP_ENDPOINT not set, tracing disabled');
    return;
  }

  try {
    // Dynamically import OTel packages (they're optional dependencies)
    const { NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node');
    const { SimpleSpanProcessor } = await import('@opentelemetry/sdk-trace-base');
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    const { Resource } = await import('@opentelemetry/resources');
    const { SemanticResourceAttributes } = await import('@opentelemetry/semantic-conventions');

    const provider = new NodeTracerProvider({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: 'primeloop-backend',
        [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
      }),
    });

    const exporter = new OTLPTraceExporter({
      url: otlpEndpoint,
    });

    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
    provider.register();

    // Store tracer instance
    const api = await import('@opentelemetry/api');
    tracer = api.trace.getTracer('primeloop-modules');

    console.log('[observer.trace] Initialized OTLP exporter to', otlpEndpoint);
  } catch (err) {
    console.warn('[observer.trace] Failed to initialize OTel:', (err as Error).message);
    console.log('[observer.trace] Install @opentelemetry/* packages to enable tracing');
  }
}

// Default export for module loader
export default OBSERVER_TRACE_MODULE;
