import { fileURLToPath } from 'node:url'
import { LauncherServer } from './server.js'
import { createLauncherRuntimeAdapter } from './adapters.js'
import { RuntimeManager } from './runtime-manager.js'

export { LauncherServer } from './server.js'
export { verifyAuthToken, generateAuthToken, validateToken, extractAgentIdFromToken } from './auth.js'
export { checkLauncherHealth, checkContainerRuntimeHealth, HealthStatus } from './health.js'
export {
  createLauncherRuntimeAdapter,
  DockerLauncherAdapter,
  OpenSandboxLauncherAdapter,
  type AdapterHealthResult,
  type AdapterProvisionInput,
  type AdapterRuntimeState,
  type LauncherRuntimeAdapter,
} from './adapters.js'
export {
  RuntimeManager,
  ProvisionRequest,
  ProvisionResponse,
  ProvisionRuntimeResult,
  RuntimeStatus,
  MountSpec,
  NetworkPolicy,
} from './runtime-manager.js'

export function startLauncherServer(port = parseInt(process.env.LAUNCHER_PORT || '8787', 10)): void {
  const runtimeManager = new RuntimeManager(createLauncherRuntimeAdapter())
  const server = new LauncherServer(runtimeManager)
  console.log('Starting launcher service...')
  server.listen(port)
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url)
if (isEntrypoint) {
  startLauncherServer()
}
