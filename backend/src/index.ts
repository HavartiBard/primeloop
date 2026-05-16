import http from 'http'
import { WebSocketServer } from 'ws'
import { createPool, runMigrations, seedRegistry } from './db.js'
import { listAgents, upsertLocalCodexProvider } from './registry.js'
import { createBroadcaster } from './ws/broadcast.js'
import { createApp } from './app.js'
import { createSlackBot, notifyApprovalNeeded } from './slack/bot.js'
import { insertEvent } from './events/store.js'
import type { AgentEvent } from './events/types.js'
import { startIntegration, stopIntegration } from './dispatch.js'
import { startAuditScheduler } from './audits.js'
import { OpenCodeProcessManager } from './opencode/process-manager.js'
import { PostgresCheckpointStore } from './checkpoint-store.js'
import { createPrimeAgentService } from './prime-agent/service.js'
import { FleetDispatcher } from './fleet-executor/dispatcher.js'

const {
  DATABASE_URL = '',
  PORT = '3100',
  LANGGRAPH_API_URL = 'http://langgraph-agent:8000',
  SLACK_BOT_TOKEN = '',
  SLACK_APP_TOKEN = '',
  SLACK_CHANNEL_ID = 'C0AU0620ATX',
  SSH_KEY_PATH = '/app/ssh/id_ed25519_homelab',
  SSH_USER = 'root',
} = process.env

if (!DATABASE_URL) throw new Error('DATABASE_URL is required')

const pool = createPool(DATABASE_URL)
await runMigrations(pool)
await seedRegistry(pool, process.env)
await upsertLocalCodexProvider(pool)

const checkpointStore = new PostgresCheckpointStore(pool)
const recoveredCount = await checkpointStore.recoverStaleItems()
if (recoveredCount > 0) {
  console.log(`Recovered ${recoveredCount} stale checkpoint item(s)`)
}
const primeAgentService = createPrimeAgentService(pool, { checkpointStore })
await primeAgentService.start()
const processManager = new OpenCodeProcessManager(pool)
await processManager.initialize()

const fleetDispatcher = new FleetDispatcher({
  pool,
  primeQueue: primeAgentService.queue,
  getHarness: (agentId) => processManager.getRunningHarness(agentId),
})
fleetDispatcher.start()
console.log('Fleet dispatcher started')

const { broadcast: rawBroadcast, addClient } = createBroadcaster()

let slackApp: ReturnType<typeof createSlackBot> | null = null

// Wrap broadcast to notify Slack on approval.needed events
function broadcast(event: AgentEvent): void {
  rawBroadcast(event)
  if (slackApp && event.type === 'approval.needed') {
    const p = event.payload as { approval_id?: string; run_id?: string; action?: string }
    if (p.approval_id && p.run_id && p.action) {
      notifyApprovalNeeded(slackApp, SLACK_CHANNEL_ID, {
        approvalId: p.approval_id,
        runId: p.run_id,
        action: p.action,
      }).catch(console.error)
    }
  }
}

// Start integrations for all enabled agents from the registry
const agents = await listAgents(pool)
for (const agent of agents) {
  startIntegration(agent, { pool, broadcast })
}
const auditTasks = await startAuditScheduler(pool)
if (auditTasks.length > 0) {
  console.log(`Started ${auditTasks.length} audit scheduler(s)`)
}

const app = createApp({
  pool,
  broadcast,
  addClient,
  langgraphApiUrl: LANGGRAPH_API_URL,
  sshKeyPath: SSH_KEY_PATH,
  sshUser: SSH_USER,
  primeQueue: primeAgentService.queue,
  onPrimeConfigUpdated: () => primeAgentService.start(),
  onAgentCreated: (agent) => {
    startIntegration(agent, { pool, broadcast })
    void processManager.syncAgent(agent)
  },
  onAgentUpdated: (agent) => {
    stopIntegration(agent.id)
    startIntegration(agent, { pool, broadcast })
    void processManager.syncAgent(agent)
  },
  onAgentDeleted: (id) => {
    stopIntegration(id)
    processManager.stopAgent(id)
  },
})
const server = http.createServer(app)

const wss = new WebSocketServer({ server, path: '/ws' })
wss.on('connection', (ws) => addClient(ws))

// Start Slack bot if configured
if (SLACK_BOT_TOKEN && SLACK_APP_TOKEN) {
  slackApp = createSlackBot({
    botToken: SLACK_BOT_TOKEN,
    appToken: SLACK_APP_TOKEN,
    channelId: SLACK_CHANNEL_ID,
    onApprove: async (approvalId) => {
      await fetch(`${LANGGRAPH_API_URL}/approvals/${approvalId}/approve`, { method: 'POST' })
    },
    onDeny: async (approvalId) => {
      await fetch(`${LANGGRAPH_API_URL}/approvals/${approvalId}/deny`, { method: 'POST' })
    },
  })
  await slackApp.start()
  console.log('Slack bot started')
}

server.listen(parseInt(PORT), () => {
  console.log(`Agent control plane backend listening on :${PORT}`)
})

process.on('SIGTERM', async () => {
  await fleetDispatcher.stop()
  await primeAgentService.close()
  server.close()
  await pool.end()
  process.exit(0)
})
