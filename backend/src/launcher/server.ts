import express, { Request, Response, NextFunction } from 'express'
import { verifyAuthToken } from './auth.js'
import { checkLauncherHealth, HealthStatus } from './health.js'
import { ProvisionRequest, ProvisionResponse, RuntimeStatus, RuntimeManager } from './runtime-manager.js'

export class LauncherServer {
  private app: express.Application
  private runtimeManager: RuntimeManager

  constructor(runtimeManager: RuntimeManager) {
    this.app = express()
    this.runtimeManager = runtimeManager
    this.configureMiddleware()
    this.configureRoutes()
  }

  private configureMiddleware(): void {
    this.app.use(express.json())
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path === '/health') {
        next()
        return
      }

      const authHeader = req.headers['authorization']
      if (typeof authHeader !== 'string' || !verifyAuthToken(authHeader)) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      next()
    })
  }

  private configureRoutes(): void {
    this.app.get('/health', async (_req: Request, res: Response): Promise<void> => {
      const health: HealthStatus = await checkLauncherHealth()
      res.json(health)
    })

    this.app.post('/agents', async (req: Request, res: Response): Promise<void> => {
      const provisionRequest: ProvisionRequest = req.body
      try {
        const result = await this.runtimeManager.provisionRuntime(provisionRequest)
        const { created, ...payload } = result
        res.status(created ? 201 : 200).json(payload as ProvisionResponse)
      } catch (error) {
        res.status(502).json({ error: 'Bad Gateway', message: (error as Error).message })
      }
    })

    this.app.get('/agents/:agentId', async (req: Request, res: Response): Promise<void> => {
      const agentId = Array.isArray(req.params.agentId) ? req.params.agentId[0] : req.params.agentId
      try {
        const status: RuntimeStatus = await this.runtimeManager.inspectRuntime(agentId)
        res.json(status)
      } catch (error) {
        if ((error as Error).message === 'Not found') {
          res.status(404).json({ error: 'Not Found', message: (error as Error).message })
        } else {
          res.status(502).json({ error: 'Bad Gateway', message: (error as Error).message })
        }
      }
    })

    this.app.post('/agents/:agentId/restart', async (req: Request, res: Response): Promise<void> => {
      const agentId = Array.isArray(req.params.agentId) ? req.params.agentId[0] : req.params.agentId
      try {
        const status: RuntimeStatus = await this.runtimeManager.restartRuntime(agentId)
        res.json(status)
      } catch (error) {
        if ((error as Error).message === 'Not found') {
          res.status(404).json({ error: 'Not Found', message: (error as Error).message })
        } else {
          res.status(502).json({ error: 'Bad Gateway', message: (error as Error).message })
        }
      }
    })

    this.app.delete('/agents/:agentId', async (req: Request, res: Response): Promise<void> => {
      const agentId = Array.isArray(req.params.agentId) ? req.params.agentId[0] : req.params.agentId
      try {
        await this.runtimeManager.teardownRuntime(agentId)
        res.status(204).send()
      } catch (error) {
        if ((error as Error).message === 'Not found') {
          res.status(404).json({ error: 'Not Found', message: (error as Error).message })
        } else {
          res.status(502).json({ error: 'Bad Gateway', message: (error as Error).message })
        }
      }
    })
  }

  public getApp(): express.Application {
    return this.app
  }

  public listen(port: number): void {
    this.app.listen(port, () => {
      console.log(`Launcher server listening on port ${port}`)
    })
  }
}
