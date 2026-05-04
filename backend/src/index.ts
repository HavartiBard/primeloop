import http from 'http'
import { WebSocketServer } from 'ws'
import { createPool, runMigrations, seedRegistry } from './db.js'
import { listAgents } from './registry.js'
import { createBroadcaster } from './ws/broadcast.js'
import { createApp } from './app.js'
import { createSlackBot, notifyApprovalNeeded } from './slack/bot.js'
import { insertEvent } from './events/store.js'
import type { AgentEvent } from './events/types.js'
import { startIntegration, stopIntegration } from './dispatch.js'

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

const app = createApp({
  pool,
  broadcast,
  addClient,
  langgraphApiUrl: LANGGRAPH_API_URL,
  sshKeyPath: SSH_KEY_PATH,
  sshUser: SSH_USER,
  onAgentCreated: (agent) => startIntegration(agent, { pool, broadcast }),
  onAgentDeleted: (id) => stopIntegration(id),
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
