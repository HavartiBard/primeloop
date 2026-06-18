/**
 * OpenTelemetry initialization for PrimeLoop backend.
 *
 * Provides default instrumentation for Prime sessions and module execution.
 * Configured via environment variables:
 *   OTEL_SERVICE_NAME - Service name (default: primeloop-backend)
 *   OTEL_EXPORTER_OTLP_ENDPOINT - OTLP export endpoint (optional)
 *   OTEL_RESOURCE_ATTRIBUTES - Resource attributes (optional)
 *   OTEL_TRACES_EXPORTER - Exporter type (default: otlp)
 *
 * If OTEL_EXPORTER_OTLP_ENDPOINT is not set, tracing initializes but exports are disabled.
 * This allows tracing to be enabled in dev without forcing an exporter.
 */

import type { Span } from '@opentelemetry/api'

let tracerProvider: any = null
let tracer: any = null
let initialized = false
let initError: string | null = null

export interface OTelInitOptions {
  serviceName?: string
  otlpEndpoint?: string
  resourceAttributes?: Record<string, string>
}

/**
 * Initialize OpenTelemetry at backend startup.
 * Must be called before any tracing operations.
 */
export async function initOTel(options: OTelInitOptions = {}): Promise<void> {
  if (initialized) return

  const serviceName = options.serviceName || process.env.OTEL_SERVICE_NAME || 'primeloop-backend'
  const otlpEndpoint = options.otlpEndpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  const resourceAttrs = options.resourceAttributes || parseResourceAttributes(process.env.OTEL_RESOURCE_ATTRIBUTES)

  try {
    // Dynamically import OTel packages (optional dependencies)
    const api = await import('@opentelemetry/api')
    const NodeTracerProvider = (await import('@opentelemetry/sdk-trace-node')).NodeTracerProvider
    const ResourceModule = await import('@opentelemetry/resources')
    const Resource = (ResourceModule as any).Resource || (ResourceModule as any).default?.Resource
    const { SemanticResourceAttributes } = await import('@opentelemetry/semantic-conventions')

    // Build resource attributes
    const attrs: Record<string, string> = {
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '0.1.0',
      [SemanticResourceAttributes.SERVICE_NAMESPACE]: 'primeloop',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
    }

    // Add custom resource attributes
    for (const [key, value] of Object.entries(resourceAttrs)) {
      attrs[key] = value
    }

    const provider = new NodeTracerProvider({
      resource: new Resource(attrs),
    })

    // Configure exporter if endpoint is set
    if (otlpEndpoint) {
      const SimpleSpanProcessor = (await import('@opentelemetry/sdk-trace-base')).SimpleSpanProcessor
      const OTLPTraceExporter = (await import('@opentelemetry/exporter-trace-otlp-http')).OTLPTraceExporter

      const exporter = new OTLPTraceExporter({
        url: otlpEndpoint,
      })

      provider.register()
      console.log(`[otel] Initialized OTLP exporter to ${otlpEndpoint}, service=${serviceName}`)
    } else {
      console.log('[otel] Tracing initialized (no exporter configured - set OTEL_EXPORTER_OTLP_ENDPOINT to enable export)')
    }

    provider.register()
    tracerProvider = provider
    tracer = api.trace.getTracer('primeloop', '0.1.0')
    initialized = true
  } catch (err) {
    const message = (err as Error).message
    initError = message

    // Check if packages are installed
    try {
      await import('@opentelemetry/api')
      console.warn('[otel] @opentelemetry/api is installed, but other packages may be missing')
      console.warn('[otel] Install with: npm install @opentelemetry/sdk-trace-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions')
    } catch {
      console.log('[otel] OpenTelemetry not available - packages not installed')
      console.log('[otel] To enable tracing: npm install @opentelemetry/sdk-trace-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions')
    }
  }
}

/**
 * Get the current tracer. Returns undefined if not initialized or packages missing.
 */
export function getTracer(): any | undefined {
  return tracer
}

/**
 * Check if OTel is initialized and available.
 */
export function isOTelInitialized(): boolean {
  return initialized && !!tracer
}

/**
 * Get initialization error if any.
 */
export function getInitError(): string | null {
  return initError
}

/**
 * Create a root span for a Prime session.
 */
export function createPrimeSessionSpan(
  sessionId: string,
  eventType: string,
  triggerType: string,
  workspaceRoot?: string,
  workspaceRevision?: string
): Span | undefined {
  if (!tracer) return undefined

  const span = tracer.startSpan(`prime.session.${eventType}`, {
    attributes: {
      'prime.session_id': sessionId,
      'prime.event_type': eventType,
      'prime.trigger_type': triggerType,
      'prime.workspace_root': workspaceRoot || '',
      'prime.workspace_revision': workspaceRevision || '',
    },
  })

  return span
}

/**
 * Create a child span for module execution.
 */
export function createModuleSpan(
  parentSpan: Span,
  moduleId: string,
  stage: string,
  version: string,
  mode: 'active' | 'shadow' = 'active'
): Span | undefined {
  if (!parentSpan) return undefined

  const span = parentSpan.spanContext()
    ? tracer?.startSpan(`module.${moduleId}`, {
        attributes: {
          'prime.module.id': moduleId,
          'prime.module.stage': stage,
          'prime.module.version': version,
          'prime.module.mode': mode,
        },
      })
    : undefined

  return span
}

/**
 * Record module execution completion.
 */
export function recordModuleCompletion(
  span: Span | undefined,
  status: 'success' | 'failed' | 'no-op',
  detail?: string
): void {
  if (!span) return

  const attrs: Record<string, any> = { status }
  if (detail) attrs.detail = detail
  
  span.addEvent('module.completed', attrs)

  if (status === 'failed') {
    span.setStatus({ code: 2 }) // ERROR
  } else if (status === 'success') {
    span.setStatus({ code: 1 }) // OK
  }

  span.end()
}

/**
 * Record a decision event.
 */
export function recordDecision(
  span: Span | undefined,
  provider?: string,
  model?: string,
  tokenCount?: number,
  actionCount?: number
): void {
  if (!span) return

  const attrs: Record<string, any> = {}
  if (provider) attrs['prime.provider'] = provider
  if (model) attrs['prime.model'] = model
  if (tokenCount) attrs['prime.token_count'] = tokenCount
  if (actionCount !== undefined) attrs['prime.action_count'] = actionCount

  span.addEvent('decision.completed', attrs)
}

/**
 * Record budget information.
 */
export function recordBudget(
  span: Span | undefined,
  llmCalls: number,
  actionsDispatched: number
): void {
  if (!span) return

  span.setAttribute('prime.budget.llm_calls', llmCalls)
  span.setAttribute('prime.budget.actions_dispatched', actionsDispatched)
}

/**
 * Record an error on a span.
 */
export function recordError(span: Span | undefined, error: Error | string): void {
  if (!span) return

  const message = typeof error === 'string' ? error : error.message
  span.recordException(error instanceof Error ? error : new Error(message))
  span.setStatus({ code: 2, message })
}

/**
 * End a span with the given status.
 */
export function endSpan(span: Span | undefined, status: 'ok' | 'error' = 'ok'): void {
  if (!span) return

  if (status === 'ok') {
    span.setStatus({ code: 1 }) // OK
  } else {
    span.setStatus({ code: 2 }) // ERROR
  }

  span.end()
}

/**
 * Parse OTEL_RESOURCE_ATTRIBUTES env var into an object.
 * Format: "key1=value1,key2=value2"
 */
function parseResourceAttributes(value?: string): Record<string, string> {
  if (!value) return {}

  const attrs: Record<string, string> = {}
  for (const pair of value.split(',')) {
    const [key, val] = pair.split('=')
    if (key && val) {
      attrs[key.trim()] = val.trim()
    }
  }

  return attrs
}

/**
 * Shutdown OTel provider gracefully.
 */
export async function shutdownOTel(): Promise<void> {
  if (!tracerProvider) return

  try {
    await tracerProvider.shutdown()
    console.log('[otel] Tracer provider shutdown complete')
  } catch (err) {
    console.error('[otel] Error shutting down tracer provider:', err)
  }

  initialized = false
  tracerProvider = null
  tracer = null
}
