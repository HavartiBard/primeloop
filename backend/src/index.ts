import http from 'http'
import { WebSocketServer } from 'ws'
import { createPool, runMigrations, seedRegistry } from './db.js'
import { listAgents, upsertLocalCodexProvider } from './registry.js'
import { createBroadcaster } from './ws/broadcast.js'
import { createApp } from './app.js'
import { validateCatalogStartup, logCatalogStartup } from './catalog/startup.js'
import { setDelegationRuntimeStarter } from './delegation-runner.js'
import { createSlackBot, notifyApprovalNeeded } from './slack/bot.js'
import { insertEvent } from './events/store.js'
import type { AgentEvent } from './events/types.js'
import { startIntegration, stopIntegration } from './dispatch.js'
import { startAuditScheduler } from './audits.js'
import { OpenCodeProcessManager } from './opencode/process-manager.js'
import { PostgresCheckpointStore } from './checkpoint-store.js'
import { createPrimeAgentService } from './prime-agent/service.js'
import { FleetDispatcher } from './fleet-executor/dispatcher.js'
import { startRuntimeLeaseReclaimScheduler } from './runtime/lease.js'

const {
  DATABASE_URL = '',
  PORT = '3100',
  SLACK_BOT_TOKEN = '',
  SLACK_APP_TOKEN = '',
  SLACK_CHANNEL_ID = 'C0AU0620ATX',
  SSH_KEY_PATH = '/app/ssh/id_ed25519_homelab',
  SSH_USER = 'root',
  PRIMELOOP_MINIMAL_BOOT = process.env['ACP_MINIMAL_BOOT'] ?? '0',
  PRIMELOOP_STARTUP_TRACE = process.env['ACP_STARTUP_TRACE'] ?? '0',
  // Feature flags for managed-agent runtime alignment
  RESUME_ON_RESTART = '0',
  LAZY_PROVISIONING = '0',
  CREDENTIAL_BROKER = '0',
  EGRESS_SANDBOX = '0',
  LAUNCHER_URL = 'http://launcher:8787',
} = process.env

if (!DATABASE_URL) throw new Error('DATABASE_URL is required')
const minimalBoot = PRIMELOOP_MINIMAL_BOOT === '1'
const startupTrace = PRIMELOOP_STARTUP_TRACE === '1'

// Feature flags for managed-agent runtime alignment
const RESUME_ON_RESTART_ENABLED = RESUME_ON_RESTART === '1'
const LAZY_PROVISIONING_ENABLED = LAZY_PROVISIONING === '1'
const CREDENTIAL_BROKER_ENABLED = CREDENTIAL_BROKER === '1'
const EGRESS_SANDBOX_ENABLED = EGRESS_SANDBOX === '1'

function traceStep(message: string): void {
  if (startupTrace) {
    console.log(`[startup] ${message}`)
  }
}

const pool = createPool(DATABASE_URL)
traceStep('pool created')

// Start launcher health check service if enabled
if (EGRESS_SANDBOX_ENABLED || process.env.LAUNCHER_ENABLED === '1') {
  traceStep('starting launcher health service')
  const { startLauncherHealthService } = await import('./launcher/health.js')
  startLauncherHealthService(LAUNCHER_URL)
  traceStep('launcher health service started')
}

traceStep('running migrations')
await runMigrations(pool)
traceStep('migrations complete')
traceStep('seeding registry')
await seedRegistry(pool, process.env)
traceStep('registry seeded')

// Validate catalog source durability before continuing startup
const catalogValidation = await validateCatalogStartup()
logCatalogStartup(catalogValidation)
if (catalogValidation.warnings.some(w => w.includes('ephemeral'))) {
  console.warn('[startup] Catalog is using ephemeral storage — data will be lost on container restart')
}

traceStep('upserting local codex provider')
await upsertLocalCodexProvider(pool)
traceStep('local codex provider ready')

const checkpointStore = new PostgresCheckpointStore(pool)
traceStep('recovering stale checkpoints')
const recoveredCount = await checkpointStore.recoverStaleItems()
if (recoveredCount > 0) {
  console.log(`Recovered ${recoveredCount} stale checkpoint item(s)`)
}
traceStep('checkpoint recovery complete')

const processManager = new OpenCodeProcessManager(pool)
setDelegationRuntimeStarter((agentId) => processManager.ensureAgentStarted(agentId))
traceStep('process manager created')

async function publishStoredEvent(type: string, payload: Record<string, unknown>): Promise<void> {
  const event = await insertEvent(pool, {
    agent: 'prime',
    type,
    payload,
  })
  broadcast(event)
}

const primeAgentService = createPrimeAgentService(pool, {
  checkpointStore,
  publishEvent: publishStoredEvent,
  getHarness: (agentId) => processManager.getRunningHarness(agentId),
})
traceStep('prime agent service created')

const fleetDispatcher = new FleetDispatcher({
  pool,
  primeQueue: primeAgentService.queue,
  getHarness: (agentId) => processManager.getRunningHarness(agentId),
  ensureHarness: (agentId) => processManager.ensureHarness(agentId),
})

traceStep('starting prime agent service')
await primeAgentService.start()
traceStep('prime agent service started')

if (!minimalBoot) {
  traceStep('initializing process manager')
  await processManager.initialize()
  traceStep('process manager initialized')
  fleetDispatcher.start()
  console.log('Fleet dispatcher started')
}

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
let auditTasks: Array<{ stop: () => void }> = []
let leaseReclaimTask: { stop: () => void } | null = null

if (!minimalBoot) {
  traceStep('starting integrations')
  const agents = await listAgents(pool)
  for (const agent of agents) {
    startIntegration(agent, { pool, broadcast })
  }
  traceStep('starting audit scheduler')
  auditTasks = await startAuditScheduler(pool)
  if (auditTasks.length > 0) {
    console.log(`Started ${auditTasks.length} audit scheduler(s)`)
  }
  traceStep('audit scheduler started')

  traceStep('starting runtime lease reclaim scheduler')
  leaseReclaimTask = startRuntimeLeaseReclaimScheduler(pool, {
    onReclaimed: async (agentId) => {
      processManager.stopAgent(agentId)
    },
  })
  traceStep('runtime lease reclaim scheduler started')
}

const app = createApp({
  pool,
  broadcast,
  addClient,
  sshKeyPath: SSH_KEY_PATH,
  sshUser: SSH_USER,
  primeQueue: primeAgentService.queue,
  onPrimeConfigUpdated: () => primeAgentService.start(),
  onSetupCompleted: () => primeAgentService.start(),
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
if (!minimalBoot && SLACK_BOT_TOKEN && SLACK_APP_TOKEN) {
  traceStep('starting slack bot')
  slackApp = createSlackBot({
    botToken: SLACK_BOT_TOKEN,
    appToken: SLACK_APP_TOKEN,
    channelId: SLACK_CHANNEL_ID,
    onApprove: async () => console.log('[slack] approval webhook not configured'),
    onDeny: async () => console.log('[slack] denial webhook not configured'),
  })
  await slackApp.start()
  console.log('Slack bot started')
  traceStep('slack bot started')
}

traceStep('binding http server')
server.listen(parseInt(PORT), () => {
  console.log(`PrimeLoop backend listening on :${PORT}${minimalBoot ? ' (minimal boot)' : ''}`)
})

process.on('SIGTERM', async () => {
  setDelegationRuntimeStarter(null)
  for (const task of auditTasks) task.stop()
  leaseReclaimTask?.stop()
  await fleetDispatcher.stop()
  await primeAgentService.close()
  server.close()
  await pool.end()
  process.exit(0)
})
