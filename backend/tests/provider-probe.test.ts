import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeProvider } from '../src/setup/provider-probe.js'

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

describe('probeProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes an OpenAI-compatible provider that answers completion and tool call', async () => {
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe('http://localhost:11434/v1/chat/completions')
      call += 1
      return call === 1
        ? jsonResponse({ choices: [{ message: { content: 'OK' } }] })
        : jsonResponse({ choices: [{ message: { tool_calls: [{ function: { name: 'report_status' } }] } }] })
    }))

    const result = await probeProvider({ type: 'ollama', base_url: 'http://localhost:11434', model: 'qwen2.5:14b' })

    expect(result.completion_ok).toBe(true)
    expect(result.tool_call_ok).toBe(true)
    expect(result.hint).toBeUndefined()
  })

  it('hints at recommended models when a local model cannot tool-call', async () => {
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      call += 1
      return call === 1
        ? jsonResponse({ choices: [{ message: { content: 'OK' } }] })
        : jsonResponse({ choices: [{ message: { content: 'status is ok!' } }] })
    }))

    const result = await probeProvider({ type: 'ollama', base_url: 'http://localhost:11434', model: 'tinyllama' })

    expect(result.completion_ok).toBe(true)
    expect(result.tool_call_ok).toBe(false)
    expect(result.hint).toContain('tool call')
  })

  it('surfaces HTTP errors from the provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => '{"error":"invalid api key"}',
    } as Response)))

    const result = await probeProvider({ type: 'openai', base_url: '', api_key: 'bad', model: 'gpt-4o' })

    expect(result.completion_ok).toBe(false)
    expect(result.error).toContain('401')
  })

  it('detects anthropic tool_use blocks', async () => {
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe('https://api.anthropic.com/v1/messages')
      call += 1
      return call === 1
        ? jsonResponse({ content: [{ type: 'text', text: 'OK' }] })
        : jsonResponse({ content: [{ type: 'tool_use', name: 'report_status', input: { status: 'ok' } }] })
    }))

    const result = await probeProvider({ type: 'anthropic', api_key: 'sk-ant-test', model: 'claude-sonnet-5' })

    expect(result.completion_ok).toBe(true)
    expect(result.tool_call_ok).toBe(true)
  })

  it('reports network failures as errors, not crashes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection refused') }))

    const result = await probeProvider({ type: 'vllm', base_url: 'http://localhost:8000', model: 'qwen2.5:14b' })

    expect(result.completion_ok).toBe(false)
    expect(result.tool_call_ok).toBe(false)
    expect(result.error).toContain('connection refused')
  })
})
