import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DISCOVERY_HOSTS, discoverLocalLlmEndpoints, loadLocalLlmConfig } from '../src/local-llm.js'

function mockFetchReachable(reachableUrlPrefix: string) {
  return vi.fn(async (url: string | URL) => {
    const target = String(url)
    if (target.startsWith(reachableUrlPrefix)) {
      return {
        ok: true,
        json: async () => ({ models: [{ name: 'qwen3:14b' }] }),
      } as Response
    }
    throw new Error('connection refused')
  })
}

describe('loadLocalLlmConfig default-host discovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null when not enabled and nothing configured', async () => {
    const config = await loadLocalLlmConfig({} as NodeJS.ProcessEnv)
    expect(config).toBeNull()
  })

  it('probes host.docker.internal when enabled without a host', async () => {
    vi.stubGlobal('fetch', mockFetchReachable('http://host.docker.internal:11434'))

    const config = await loadLocalLlmConfig({ LOCAL_LLM_ENABLED: '1' } as NodeJS.ProcessEnv)

    expect(config).not.toBeNull()
    expect(config!.discovery_error).toBeUndefined()
    expect(config!.type).toBe('ollama')
    expect(config!.base_url).toBe('http://host.docker.internal:11434')
    expect(config!.autodiscovered).toBe(true)
  })

  it('falls back to localhost when host.docker.internal is unreachable', async () => {
    vi.stubGlobal('fetch', mockFetchReachable('http://localhost:11434'))

    const config = await loadLocalLlmConfig({ LOCAL_LLM_ENABLED: '1' } as NodeJS.ProcessEnv)

    expect(config).not.toBeNull()
    expect(config!.discovery_error).toBeUndefined()
    expect(config!.base_url).toBe('http://localhost:11434')
  })

  it('reports a discovery error naming the probed hosts when nothing is reachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection refused') }))

    const config = await loadLocalLlmConfig({ LOCAL_LLM_ENABLED: '1' } as NodeJS.ProcessEnv)

    expect(config).not.toBeNull()
    for (const host of DEFAULT_DISCOVERY_HOSTS) {
      expect(config!.discovery_error).toContain(host)
    }
    expect(config!.base_url).toBe('')
  })

  it('discoverLocalLlmEndpoints returns all reachable endpoints with models, deduped across hosts', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const target = String(url)
      // The same Ollama server is reachable via both hostnames
      if (target.endsWith(':11434/api/tags')) {
        return { ok: true, json: async () => ({ models: [{ name: 'qwen2.5:14b' }, { name: 'llama3.1:8b' }] }) } as Response
      }
      if (target.includes(':1234/') && target.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'mistral-small-3' }] }) } as Response
      }
      if (target.includes(':1234/')) {
        return { ok: false, status: 404, json: async () => ({}) } as Response
      }
      throw new Error('connection refused')
    }))

    const endpoints = await discoverLocalLlmEndpoints()

    const ollama = endpoints.filter((e) => e.type === 'ollama')
    expect(ollama).toHaveLength(1) // deduped: same models via both hostnames
    expect(ollama[0].models).toEqual(['qwen2.5:14b', 'llama3.1:8b'])
    const lmstudio = endpoints.find((e) => e.type === 'lmstudio')
    expect(lmstudio?.models).toEqual(['mistral-small-3'])
  })

  it('does not report a generic web app that 200s every path as an LLM server', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const target = String(url)
      if (target.includes(':8080/')) {
        // SPA-style server: 200 with HTML for any path, {"status":true} health
        if (target.endsWith('/health')) {
          return { ok: true, json: async () => ({ status: true }) } as Response
        }
        return { ok: true, json: async () => { throw new Error('body is HTML, not JSON') } } as unknown as Response
      }
      throw new Error('connection refused')
    }))

    const endpoints = await discoverLocalLlmEndpoints()

    expect(endpoints).toHaveLength(0)
  })

  it('still respects an explicit LOCAL_LLM_BASE_URL without probing', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const config = await loadLocalLlmConfig({
      LOCAL_LLM_ENABLED: '1',
      LOCAL_LLM_BASE_URL: 'http://192.0.2.10:11434',
    } as NodeJS.ProcessEnv)

    expect(config!.base_url).toBe('http://192.0.2.10:11434')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
