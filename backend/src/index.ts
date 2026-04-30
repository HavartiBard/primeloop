import http from 'http'
import { WebSocketServer } from 'ws'
import cron from 'node-cron'
import { createPool, runMigrations } from './db.js'
import { createBroadcaster } from './ws/broadcast.js'
import { createApp } from './app.js'
import { pollRaclette, upsertHeartbeat } from './agents/raclette.js'
import { createSlackBot, notifyApprovalNeeded } from './slack/bot.js'
import { insertEvent } from './events/store.js'
import type { AgentEvent } from './events/types.js'

const {
  DATABASE_URL = '',
  PORT = '3100',
  LANGGRAPH_API_URL = 'http://langgraph-agent:8000',
  RACLETTE_API_URL = 'http://192.168.20.169:9119',
  RACLETTE_SESSION_TOKEN = '',
  SLACK_BOT_TOKEN = '',
  SLACK_APP_TOKEN = '',
  SLACK_CHANNEL_ID = 'C0AU0620ATX',
} = process.env

if (!DATABASE_URL) throw new Error('DATABASE_URL is required')

const pool = createPool(DATABASE_URL)
await runMigrations(pool)

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

const app = createApp({ pool, broadcast, addClient, langgraphApiUrl: LANGGRAPH_API_URL })
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

// Poll Raclette every 30s
cron.schedule('*/30 * * * * *', () => {
  pollRaclette({
    apiUrl: RACLETTE_API_URL,
    sessionToken: RACLETTE_SESSION_TOKEN,
    pool,
    insertEvent,
    broadcast,
    upsertHeartbeat,
  }).catch(console.error)
})

server.listen(parseInt(PORT), () => {
  console.log(`Agent control plane backend listening on :${PORT}`)
})
