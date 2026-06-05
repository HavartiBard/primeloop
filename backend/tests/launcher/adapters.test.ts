import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLauncherRuntimeAdapter, DockerLauncherAdapter, OpenSandboxLauncherAdapter } from '../../src/launcher/adapters.js'

const ORIGINAL_ENV = { ...process.env }

describe('launcher adapters', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.restoreAllMocks()
  })

  it('defaults to the docker adapter', () => {
    delete process.env.LAUNCHER_ADAPTER
    const adapter = createLauncherRuntimeAdapter()
    expect(adapter).toBeInstanceOf(DockerLauncherAdapter)
  })

  it('selects the opensandbox adapter when configured', () => {
    process.env.LAUNCHER_ADAPTER = 'opensandbox'
    const adapter = createLauncherRuntimeAdapter()
    expect(adapter).toBeInstanceOf(OpenSandboxLauncherAdapter)
  })

  it('reports opensandbox health from its API', async () => {
    process.env.LAUNCHER_ADAPTER = 'opensandbox'
    const adapter = createLauncherRuntimeAdapter()
    const get = vi.spyOn((adapter as OpenSandboxLauncherAdapter)['client'], 'get').mockResolvedValue({ data: { status: 'ok' } } as any)

    const health = await adapter.healthCheck()

    expect(get).toHaveBeenCalledWith('/health')
    expect(health).toEqual({ reachable: true, notes: [] })
  })
})
