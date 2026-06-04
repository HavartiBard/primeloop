import express from 'express'
import type pg from 'pg'
import { LlmProxy } from '../proxy/llm-proxy.js'

export function createLlmProxyRouter({ pool }: { pool: pg.Pool }) {
  const router = express.Router()
  const proxy = new LlmProxy(pool)

  router.all('/internal/llm/:provider/*', async (req, res) => {
    try {
      const auth = req.headers.authorization
      const token = typeof auth === 'string' && auth.startsWith('Bearer ')
        ? auth.slice('Bearer '.length)
        : ''

      const result = await proxy.forward(token, {
        provider: req.params.provider,
        path: `/${req.params[0] ?? ''}`,
        method: req.method,
        headers: Object.fromEntries(
          Object.entries(req.headers)
            .filter(([key, value]) => key.toLowerCase() !== 'authorization' && typeof value === 'string')
            .map(([key, value]) => [key, value as string])
        ),
        body: req.body,
      })

      res.status(result.statusCode)
      for (const [key, value] of Object.entries(result.headers ?? {})) {
        res.setHeader(key, value)
      }

      if (result.body instanceof Uint8Array) {
        res.send(Buffer.from(result.body))
        return
      }

      if (typeof result.body === 'string') {
        res.send(result.body)
        return
      }

      if (result.body !== undefined) {
        res.json(result.body)
        return
      }

      res.json({ error: result.error ?? 'proxy request failed' })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'internal server error' })
    }
  })

  return router
}
