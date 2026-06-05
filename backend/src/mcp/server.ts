import { createInterface } from 'node:readline'
import { createPool } from '../db.js'
import { authenticateAgentToken, callControlPlaneTool, listControlPlaneTools } from './service.js'
import { CredentialBroker } from '../credentials/broker.js'

type JsonRpcId = string | number | null

interface JsonRpcRequest {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: Record<string, unknown>
}

function respond(id: JsonRpcId, result?: unknown, error?: { code: number; message: string }): void {
  const payload = error
    ? { jsonrpc: '2.0', id, error }
    : { jsonrpc: '2.0', id, result }
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function parseAgentToken(params: Record<string, unknown> | undefined): string {
  const token = process.env.CONTROL_PLANE_AGENT_TOKEN
    ?? (typeof params?.['_token'] === 'string' ? params['_token'] : '')
  if (!token) throw new Error('CONTROL_PLANE_AGENT_TOKEN is required')
  return token
}

async function authenticateControlPlaneToken(pool: ReturnType<typeof createPool>, token: string) {
  const broker = new CredentialBroker(pool)
  const brokered = await broker.validate(token)
  if (brokered?.kind === 'launcher_token') {
    const { rows } = await pool.query(
      `SELECT * FROM agents WHERE id = $1 LIMIT 1`,
      [brokered.agent_id],
    )
    if (rows[0]) {
      return { agent: rows[0], token }
    }
  }

  return authenticateAgentToken(pool, token)
}

async function handleRequest(poolConnectionString: string, request: JsonRpcRequest): Promise<void> {
  const id = request.id ?? null
  const method = request.method
  const params = request.params ?? {}

  if (method === 'initialize') {
    respond(id, {
      serverInfo: { name: 'primeloop-mcp', version: '0.1.0' },
      capabilities: { tools: {} },
    })
    return
  }

  if (method === 'tools/list') {
    respond(id, { tools: await listControlPlaneTools() })
    return
  }

  if (method !== 'tools/call') {
    respond(id, undefined, { code: -32601, message: `Method not found: ${method}` })
    return
  }

  const toolName = typeof params['name'] === 'string' ? params['name'] : ''
  const args = typeof params['arguments'] === 'object' && params['arguments'] && !Array.isArray(params['arguments'])
    ? params['arguments'] as Record<string, unknown>
    : {}
  if (!toolName) {
    respond(id, undefined, { code: -32602, message: 'Tool name is required' })
    return
  }

  const pool = createPool(poolConnectionString)
  try {
    const token = parseAgentToken(params)
    const auth = await authenticateControlPlaneToken(pool, token)
    if (!auth) {
      respond(id, undefined, { code: -32001, message: 'Unauthorized agent token' })
      return
    }

    const result = await callControlPlaneTool(pool, auth, toolName, args)
    respond(id, {
      structuredContent: result,
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    })
  } catch (err) {
    respond(id, undefined, {
      code: -32000,
      message: err instanceof Error ? err.message : 'Unknown error',
    })
  } finally {
    await pool.end()
  }
}

const { DATABASE_URL = '' } = process.env
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required')
}

const rl = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})

rl.on('line', (line) => {
  void (async () => {
    try {
      const request = JSON.parse(line) as JsonRpcRequest
      await handleRequest(DATABASE_URL, request)
    } catch (err) {
      respond(null, undefined, {
        code: -32700,
        message: err instanceof Error ? err.message : 'Parse error',
      })
    }
  })()
})
