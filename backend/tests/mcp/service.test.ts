import { describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import {
  authenticateAgentToken,
  callControlPlaneTool,
  getControlPlaneToolDefinition,
  listControlPlaneTools,
  type AgentAuthContext,
} from '../../src/mcp/service.js'

const baseAgent = {
  id: 'agent-1',
  name: 'prime',
  type: 'worker',
  runtime_family: 'opencode',
  execution_mode: 'local',
  capabilities: ['prime', 'verification'],
  config: {},
  enabled: true,
  created_at: new Date(0).toISOString(),
}

describe('control-plane MCP service', () => {
  it('authenticates agent tokens', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [{ ...baseAgent, token: 'secret-token' }],
      }),
    } as unknown as pg.Pool

    const auth = await authenticateAgentToken(pool, 'secret-token')
    expect(auth?.agent.name).toBe('prime')
    expect(auth?.token).toBe('secret-token')
  })

  it('lists standard and prime-only tools', async () => {
    const tools = await listControlPlaneTools()
    const delegate = tools.find((tool) => tool.name === 'delegate_to_agent')
    const contextGet = tools.find((tool) => tool.name === 'context_get')
    const fleet = tools.find((tool) => tool.name === 'query_fleet_learnings')
    expect(delegate).toBeTruthy()
    expect(delegate?.inputSchema).toMatchObject({
      type: 'object',
      required: ['capability', 'prompt'],
    })
    expect(delegate?.outputSchema).toMatchObject({
      type: 'object',
      required: ['work_item', 'delegation', 'status', 'blocked'],
    })
    expect(delegate?.annotations?.readOnlyHint).toBe(false)
    expect(contextGet?.outputSchema).toMatchObject({
      required: ['soul', 'patterns', 'memories', 'lessons', 'text'],
    })
    expect(fleet?.prime_only).toBe(true)
    expect(fleet?.annotations?.readOnlyHint).toBe(true)
  })

  it('queries fleet learnings for a prime agent', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{ ...baseAgent }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            kind: 'memory',
            agent_id: 'agent-2',
            agent_name: 'worker-2',
            content: 'Remember to check migrations first.',
            category: 'process',
            importance: 4,
            severity: null,
            created_at: new Date().toISOString(),
          },
        ],
      })
    const pool = { query } as unknown as pg.Pool
    const ctx: AgentAuthContext = { agent: baseAgent, token: 'secret-token' }

    const result = await callControlPlaneTool(pool, ctx, 'query_fleet_learnings', { query: 'migrations' })
    expect(Array.isArray(result.results)).toBe(true)
    expect((result.results as Array<{ content: string }>)[0]?.content).toContain('migrations')
  })

  it('blocks prime-only tools for non-prime agents', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ ...baseAgent, capabilities: ['implementation'] }] }),
    } as unknown as pg.Pool
    const ctx: AgentAuthContext = {
      agent: { ...baseAgent, capabilities: ['implementation'] },
      token: 'secret-token',
    }

    await expect(callControlPlaneTool(pool, ctx, 'query_fleet_learnings', { query: 'x' }))
      .rejects.toThrow('forbidden: prime capability required')
  })

  it('validates arguments against the declared input schema', async () => {
    const pool = { query: vi.fn() } as unknown as pg.Pool
    const ctx: AgentAuthContext = { agent: baseAgent, token: 'secret-token' }

    await expect(callControlPlaneTool(pool, ctx, 'delegate_to_agent', { capability: 'implementation' }))
      .rejects.toThrow('arguments.prompt is required')
    await expect(callControlPlaneTool(pool, ctx, 'save_memory', { content: 'x', importance: 9 }))
      .rejects.toThrow('arguments.importance must be <= 5')
  })

  it('exposes stable tool definitions by name', () => {
    const tool = getControlPlaneToolDefinition('resolve_approval')
    expect(tool?.prime_only).toBe(true)
    expect(tool?.inputSchema).toMatchObject({
      required: ['approval_id', 'decision'],
    })
  })

  it('reads and updates soul through MCP tools', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('UPDATE agents SET')) {
        return {
          rows: [{
            ...baseAgent,
            soul: 'Prefer direct execution over delay.',
          }],
        }
      }
      throw new Error(`unexpected query: ${sql}`)
    })
    const pool = { query } as unknown as pg.Pool
    const ctx: AgentAuthContext = {
      agent: { ...baseAgent, soul: 'Keep the fleet coherent.' } as any,
      token: 'secret-token',
    }

    const readResult = await callControlPlaneTool(pool, ctx, 'soul_read', {})
    const updateResult = await callControlPlaneTool(pool, ctx, 'soul_update', {
      soul: 'Prefer direct execution over delay.',
    })

    expect(readResult.soul).toBe('Keep the fleet coherent.')
    expect((updateResult.agent as { soul: string }).soul).toContain('Prefer direct execution')
  })

  it('stores and retrieves native memories and lessons', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO agent_memories')) {
        return {
          rows: [{
            id: 'mem-1',
            agent_id: 'agent-1',
            content: 'Provider model names use slash format.',
            category: 'providers',
            tags: ['models'],
            importance: 4,
            created_at: new Date().toISOString(),
          }],
        }
      }
      if (sql.includes('INSERT INTO agent_lessons')) {
        return {
          rows: [{
            id: 'les-1',
            agent_id: 'agent-1',
            content: 'SSE readiness can lag health checks.',
            context: 'startup',
            category: 'runtime',
            severity: 'warn',
            created_at: new Date().toISOString(),
          }],
        }
      }
      throw new Error(`unexpected query: ${sql}`)
    })
    const pool = { query } as unknown as pg.Pool
    const ctx: AgentAuthContext = { agent: baseAgent, token: 'secret-token' }

    const memory = await callControlPlaneTool(pool, ctx, 'memory_store', {
      content: 'Provider model names use slash format.',
      category: 'providers',
      tags: ['models'],
      importance: 4,
    })
    const lessons = await callControlPlaneTool(pool, ctx, 'lessons_log', {
      content: 'SSE readiness can lag health checks.',
      context: 'startup',
      category: 'runtime',
      severity: 'warn',
    })

    expect((memory.memory as { id: string }).id).toBe('mem-1')
    expect((lessons.lesson as { id: string }).id).toBe('les-1')
  })

  it('assembles context from native memory service paths', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{
          ...baseAgent,
          soul: 'Keep the fleet coherent.',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'pat-1',
          type: 'best_practice',
          content: 'Write focused tests before risky edits.',
          severity: 'info',
          source_agent_id: 'agent-1',
          source_agent_name: 'prime',
          published_by: 'agent-1',
          published_by_name: 'prime',
          created_at: new Date().toISOString(),
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'mem-1',
          agent_id: 'agent-1',
          content: 'Provider model names use slash format.',
          category: 'providers',
          tags: ['models'],
          importance: 4,
          created_at: new Date().toISOString(),
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'les-1',
          agent_id: 'agent-1',
          content: 'SSE readiness can lag health checks.',
          context: 'startup',
          category: 'runtime',
          severity: 'warn',
          created_at: new Date().toISOString(),
        }],
      })
    const pool = { query } as unknown as pg.Pool
    const ctx: AgentAuthContext = { agent: baseAgent, token: 'secret-token' }

    const result = await callControlPlaneTool(pool, ctx, 'context_get', { query: 'provider startup' })
    expect(result.text).toContain('# Soul')
    expect(Array.isArray(result.patterns)).toBe(true)
    expect(Array.isArray(result.memories)).toBe(true)
    expect(Array.isArray(result.lessons)).toBe(true)
  })
})
