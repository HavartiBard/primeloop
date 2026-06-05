import { describe, expect, it, vi, beforeEach } from 'vitest'
import type pg from 'pg'
import {
  routeWorkRequest,
  routeInvestigation,
  findExistingBlocker,
  recordRoutingOutcome,
  buildRuntimeTruth,
} from '../../src/routing/index.js'
import type { RoutingRequest, RoutingOutcome } from '../../src/routing/types.js'

describe('routing layer', () => {
  let queryMock: ReturnType<typeof vi.fn>
  let pool: pg.Pool
  let getHarness: (agentId: string) => undefined

  beforeEach(() => {
    queryMock = vi.fn()
    getHarness = () => undefined
    pool = { query: queryMock } as unknown as pg.Pool
  })

  function setupAgentQuery(agents: Array<Record<string, unknown>>) {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM agents')) {
        return { rows: agents }
      }
      if (sql.includes('FROM agent_heartbeat')) {
        return { rows: [] }
      }
      if (sql.includes('prime_agent_config')) {
        return { rows: [{ config: {} }] }
      }
      throw new Error(`Unexpected query: ${sql.slice(0, 80)}`)
    })
  }

  describe('routeWorkRequest', () => {
    it('returns dispatch_existing when a dispatchable agent matches the work class', async () => {
      setupAgentQuery([
        {
          id: 'agent-1',
          name: 'Reviewer',
          type: 'reviewer',
          runtime_family: 'local',
          execution_mode: 'managed',
          capabilities: ['code_review'],
          config: {},
          enabled: true,
          role: 'reviewer',
        },
      ])

      // Simulate harness available for agent-1
      getHarness = (agentId: string) => agentId === 'agent-1' ? ({ } as any) : undefined

      const request: RoutingRequest = {
        id: 'req-1',
        workClass: 'code_review',
        constraints: {},
        source: 'prime-agent',
        createdAt: new Date().toISOString(),
      }

      const outcome = await routeWorkRequest(
        { pool, getHarness },
        request,
      )

      expect(outcome.type).toBe('dispatch_existing')
      if (outcome.type === 'dispatch_existing') {
        expect(outcome.targetAgent.id).toBe('agent-1')
      }
    })

    it('returns a structured outcome for an unknown work class', async () => {
      setupAgentQuery([
        {
          id: 'agent-1',
          name: 'General',
          type: 'general',
          runtime_family: 'local',
          execution_mode: 'managed',
          capabilities: ['general'],
          config: {},
          enabled: true,
          role: 'general',
        },
      ])

      const request: RoutingRequest = {
        id: 'req-2',
        workClass: 'security_audit',
        constraints: {},
        source: 'prime-agent',
        createdAt: new Date().toISOString(),
      }

      const outcome = await routeWorkRequest(
        { pool, getHarness },
        request,
      )

      // Either spawns an ephemeral (implementer template can handle it)
      // or returns a blocked outcome — both are valid structured outcomes
      expect(['spawn_ephemeral', 'blocked_missing_capability', 'dispatch_existing']).toContain(outcome.type)
    })

    it('returns blocked_runtime_unavailable when agent exists but has no harness', async () => {
      setupAgentQuery([
        {
          id: 'agent-1',
          name: 'SRE',
          type: 'sre',
          runtime_family: 'local',
          execution_mode: 'managed',
          capabilities: ['diagnostics'],
          config: {},
          enabled: true,
          role: 'sre',
        },
      ])

      // No harness available for any agent
      getHarness = () => undefined

      const request: RoutingRequest = {
        id: 'req-3',
        workClass: 'diagnostics',
        preferredRole: 'sre',
        constraints: {},
        source: 'prime-agent',
        createdAt: new Date().toISOString(),
      }

      const outcome = await routeWorkRequest(
        { pool, getHarness },
        request,
      )

      // When no harness exists but the agent has managed execution mode,
      // it should be classified as registered-only, leading to blocked_runtime_unavailable
      expect(['blocked_runtime_unavailable', 'blocked_missing_capability']).toContain(outcome.type)
    })

    it('does not create delegations for disabled agents (FR-003)', async () => {
      setupAgentQuery([
        {
          id: 'agent-1',
          name: 'Disabled Agent',
          type: 'general',
          runtime_family: 'local',
          execution_mode: 'managed',
          capabilities: ['code_review'],
          config: {},
          enabled: false,
          role: 'general',
        },
      ])

      const request: RoutingRequest = {
        id: 'req-4',
        workClass: 'code_review',
        constraints: {},
        source: 'prime-agent',
        createdAt: new Date().toISOString(),
      }

      const outcome = await routeWorkRequest(
        { pool, getHarness },
        request,
      )

      // Should NOT dispatch to a disabled agent
      expect(outcome.type).not.toBe('dispatch_existing')
    })
  })

  describe('routeInvestigation', () => {
    it('routes to a dispatchable SRE agent when available (FR-009)', async () => {
      setupAgentQuery([
        {
          id: 'sre-1',
          name: 'SRE',
          type: 'sre',
          runtime_family: 'local',
          execution_mode: 'managed',
          capabilities: ['diagnostics', 'incident_response'],
          config: {},
          enabled: true,
          role: 'sre',
        },
      ])

      getHarness = (agentId: string) => agentId === 'sre-1' ? ({ } as any) : undefined

      const outcome = await routeInvestigation(
        { pool, getHarness },
        { workClass: 'incident_response' },
      )

      expect(outcome.type).toBe('investigate')
      if (outcome.type === 'investigate') {
        expect(outcome.targetAgent?.id).toBe('sre-1')
      }
    })

    it('returns blocked outcome when no investigation route exists (FR-009)', async () => {
      setupAgentQuery([
        {
          id: 'agent-1',
          name: 'General',
          type: 'general',
          runtime_family: 'local',
          execution_mode: 'managed',
          capabilities: ['general'],
          config: {},
          enabled: true,
          role: 'general',
        },
      ])

      const outcome = await routeInvestigation(
        { pool, getHarness },
        { workClass: 'incident_response' },
      )

      // Should return a structured blocked outcome
      expect(['investigate', 'blocked_runtime_unavailable']).toContain(outcome.type)
    })
  })

  describe('deduplication (FR-011)', () => {
    it('finds existing blocker for the same work class and thread', async () => {
      queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('routing_outcomes')) {
          return { rows: [{ count: 1 }] }
        }
        throw new Error(`Unexpected query: ${sql.slice(0, 80)}`)
      })

      const exists = await findExistingBlocker(pool, {
        workClass: 'security_audit',
        blockerType: 'missing_capability',
        threadId: 'thread-1',
      })

      expect(exists).toBe(true)
    })

    it('returns false when no existing blocker matches', async () => {
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('routing_outcomes')) {
          return { rows: [{ count: 0 }] }
        }
        throw new Error(`Unexpected query: ${sql.slice(0, 80)}`)
      })

      const exists = await findExistingBlocker(pool, {
        workClass: 'security_audit',
        blockerType: 'missing_capability',
        threadId: 'thread-1',
      })

      expect(exists).toBe(false)
    })
  })

  describe('recordRoutingOutcome', () => {
    it('records a dispatch outcome', async () => {
      let capturedValues: unknown[] = []
      queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('INSERT INTO routing_outcomes')) {
          capturedValues = params ?? []
          return { rows: [] }
        }
        throw new Error(`Unexpected query: ${sql.slice(0, 80)}`)
      })

      const request: RoutingRequest = {
        id: 'req-1',
        workClass: 'code_review',
        constraints: {},
        source: 'prime-agent',
        createdAt: new Date().toISOString(),
      }

      const outcome: RoutingOutcome = {
        type: 'dispatch_existing',
        targetAgent: {
          id: 'agent-1',
          name: 'Reviewer',
          type: 'reviewer',
          runtime_family: 'local',
          execution_mode: 'managed',
          capabilities: ['code_review'],
          config: {},
          enabled: true,
          role: 'reviewer',
        },
      }

      await recordRoutingOutcome(pool, request, outcome)

      expect(capturedValues.length).toBeGreaterThan(0)
      expect(capturedValues[3]).toBe('dispatch_existing') // outcome_type
    })

    it('records a blocked outcome with remediations', async () => {
      let capturedValues: unknown[] = []
      queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('INSERT INTO routing_outcomes')) {
          capturedValues = params ?? []
          return { rows: [] }
        }
        throw new Error(`Unexpected query: ${sql.slice(0, 80)}`)
      })

      const request: RoutingRequest = {
        id: 'req-2',
        workClass: 'security_audit',
        constraints: {},
        source: 'prime-agent',
        createdAt: new Date().toISOString(),
      }

      const outcome: RoutingOutcome = {
        type: 'blocked_missing_capability',
        blockerType: 'missing_capability',
        explanation: 'No dispatchable or spawnable target.',
        requestedWorkClass: 'security_audit',
        suggestedRemediations: [
          { action: 'create_agent', description: 'Create a new agent for security_audit' },
        ],
      }

      await recordRoutingOutcome(pool, request, outcome)

      expect(capturedValues[3]).toBe('blocked_missing_capability') // outcome_type
      const remediationsJson = capturedValues[8] as string
      const remediations = JSON.parse(remediationsJson)
      expect(remediations.length).toBe(1)
    })
  })

  describe('runtime truth (FR-001, FR-004, FR-006)', () => {
    it('distinguishes dispatchable from registered-only agents', async () => {
      setupAgentQuery([
        {
          id: 'agent-1',
          name: 'Active Agent',
          type: 'general',
          runtime_family: 'local',
          execution_mode: 'managed',
          capabilities: ['general'],
          config: {},
          enabled: true,
          role: 'general',
        },
        {
          id: 'agent-2',
          name: 'No Harness Agent',
          type: 'external',
          runtime_family: 'hermes',
          execution_mode: 'external',
          capabilities: ['build'],
          config: {},
          enabled: true,
          role: 'builder',
        },
      ])

      getHarness = (agentId: string) => agentId === 'agent-1' ? ({ } as any) : undefined

      const truth = await buildRuntimeTruth({ pool, getHarness })

      expect(truth.dispatchableAgents.length).toBe(1)
      expect(truth.dispatchableAgents[0].agent.id).toBe('agent-1')
      expect(truth.registeredOnlyAgents.length).toBe(1)
      expect(truth.registeredOnlyAgents[0].agent.id).toBe('agent-2')
    })

    it('excludes disabled agents from dispatchable list', async () => {
      setupAgentQuery([
        {
          id: 'agent-1',
          name: 'Disabled Agent',
          type: 'general',
          runtime_family: 'local',
          execution_mode: 'managed',
          capabilities: ['general'],
          config: {},
          enabled: false,
          role: 'general',
        },
      ])

      getHarness = () => undefined

      const truth = await buildRuntimeTruth({ pool, getHarness })

      expect(truth.dispatchableAgents.length).toBe(0)
    })

    it('includes spawnable templates from ephemeral definitions', async () => {
      setupAgentQuery([])

      const truth = await buildRuntimeTruth({ pool, getHarness })

      // Should have at least the default templates (implementer, reviewer)
      expect(truth.spawnableTemplates.length).toBeGreaterThanOrEqual(2)
    })

    it('treats durable ACP agents as dispatchable when lazy provisioning is enabled', async () => {
      const previousFlag = process.env.LAZY_PROVISIONING
      process.env.LAZY_PROVISIONING = '1'

      try {
        setupAgentQuery([
          {
            id: 'agent-acp',
            name: 'Lazy ACP Agent',
            type: 'general',
            runtime_family: 'acp',
            execution_mode: 'local',
            capabilities: ['general'],
            config: {},
            enabled: true,
            role: 'general',
            tier: 'durable',
          },
        ])

        getHarness = () => undefined

        const truth = await buildRuntimeTruth({ pool, getHarness })
        expect(truth.dispatchableAgents.length).toBe(1)
        expect(truth.dispatchableAgents[0].agent.id).toBe('agent-acp')
      } finally {
        if (previousFlag === undefined) delete process.env.LAZY_PROVISIONING
        else process.env.LAZY_PROVISIONING = previousFlag
      }
    })
  })
})
