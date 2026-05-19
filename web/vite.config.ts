import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const backendUrl = process.env['ACP_BACKEND_URL']
const useSetupDevMiddleware = !backendUrl

function sendJson(res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body?: string) => void }, statusCode: number, body: unknown) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

async function readJsonBody(req: NodeJS.ReadableStream): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) as Record<string, unknown> : {}
}

async function fetchProviderModels(body: Record<string, unknown>) {
  const type = String(body.type ?? '').trim()
  const baseUrl = String(body.base_url ?? '').trim().replace(/\/+$/, '')
  const apiKey = String(body.api_key ?? '').trim()

  if (!type || !baseUrl) {
    return { status: 400, body: { error: 'type and base_url are required' } }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5_000)

  try {
    let upstream: Response

    if (type === 'ollama') {
      upstream = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal })
      const data = await upstream.json() as { models?: Array<{ name?: string }> }
      const models = (data.models ?? []).map((model) => model.name).filter(Boolean)
      return { status: 200, body: { models } }
    }

    if (type === 'anthropic') {
      if (!apiKey) {
        return { status: 400, body: { error: 'api_key is required for anthropic model discovery' } }
      }
      upstream = await fetch(`${baseUrl}/v1/models`, {
        signal: controller.signal,
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      })
    } else {
      if (!apiKey && type !== 'litellm' && type !== 'llm') {
        return { status: 400, body: { error: 'api_key is required for model discovery' } }
      }
      upstream = await fetch(`${baseUrl}/models`, {
        signal: controller.signal,
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      })
    }

    if (!upstream.ok) {
      return { status: upstream.status, body: { error: 'provider rejected model discovery request' } }
    }

    const data = await upstream.json() as { data?: Array<{ id?: string }> }
    const models = (data.data ?? []).map((model) => model.id).filter(Boolean).sort()
    return { status: 200, body: { models } }
  } catch {
    return { status: 200, body: { error: 'unreachable', models: [] } }
  } finally {
    clearTimeout(timeout)
  }
}

const devSetupState: {
  complete: boolean
  lastPayload: Record<string, unknown> | null
} = {
  complete: false,
  lastPayload: null,
}

function handleSetupStatus() {
  return { status: 200, body: { complete: devSetupState.complete } }
}

function handleSetupComplete(body: Record<string, unknown>) {
  const providers = body.providers
  const routing = body.routing
  const persona = body.persona
  const rules = body.rules

  if (!Array.isArray(providers) || !routing || !persona || !rules) {
    return { status: 400, body: { error: 'providers, routing, persona, and rules are required' } }
  }

  devSetupState.complete = true
  devSetupState.lastPayload = body
  return { status: 200, body: { ok: true, mode: 'dev-middleware' } }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(useSetupDevMiddleware ? [{
      name: 'setup-dev-middleware',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.method === 'GET' && req.url === '/api/setup/status') {
            const result = handleSetupStatus()
            sendJson(res, result.status, result.body)
            return
          }

          if (req.method === 'POST' && req.url === '/api/setup/provider-models') {
            try {
              const body = await readJsonBody(req)
              const result = await fetchProviderModels(body)
              sendJson(res, result.status, result.body)
            } catch (err) {
              sendJson(res, 500, { error: (err as Error).message || 'internal error' })
            }
            return
          }

          if (req.method === 'POST' && req.url === '/api/setup/complete') {
            try {
              const body = await readJsonBody(req)
              const result = handleSetupComplete(body)
              sendJson(res, result.status, result.body)
            } catch (err) {
              sendJson(res, 500, { error: (err as Error).message || 'internal error' })
            }
            return
          }

          if (req.url?.startsWith('/api/setup/')) {
            sendJson(res, 503, { error: 'setup endpoint unavailable in dev middleware' })
            return
          }

          if (!req.url?.startsWith('/api') && !req.url?.startsWith('/ws')) {
            next()
            return
          }
          next()
        })
      },
    }] : []),
  ],
  server: {
    proxy: {
      '/api': backendUrl ?? 'http://localhost:3100',
      '/ws': { target: (backendUrl ?? 'http://localhost:3100').replace(/^http/, 'ws'), ws: true },
    },
  },
})
