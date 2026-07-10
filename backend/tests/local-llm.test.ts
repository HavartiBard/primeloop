import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DISCOVERY_HOSTS, loadLocalLlmConfig } from '../src/local-llm.js'

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
