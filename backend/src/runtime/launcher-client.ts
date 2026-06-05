import axios, { AxiosInstance, AxiosResponse } from 'axios';

export interface LauncherClientConfig {
  baseUrl: string;
  authToken: string;
  timeout?: number;
}

export interface AcpEndpoint {
  protocol: 'http' | 'https' | 'ws' | 'wss';
  host: string;
  port: number;
  path: string;
}

export interface ProvisionRequest {
  agentId: string;
  runtimeFamily: 'opencode';
  workdir: string;
  env: Record<string, string>;
  expectedMounts?: Array<{ path: string; mode: 'ro' | 'rw'; purpose: string }>;
  networkPolicy?: { mode: 'default-deny'; allowlist: string[] };
  runtimeImage?: string;
}

export interface ProvisionResponse {
  agentId: string;
  acpEndpoint: AcpEndpoint;
  runtimeStatus: RuntimeStatus;
  containerIdentity: string;
}

export interface RuntimeStatus {
  agentId: string;
  state: 'provisioning' | 'ready' | 'unhealthy' | 'reprovisioning' | 'tearing_down' | 'unavailable';
  healthStatus: 'healthy' | 'degraded' | 'failed' | 'unknown';
  containerIdentity: string;
  acpEndpoint: AcpEndpoint;
  workdir: string;
  mounts: Array<{ path: string; mode: 'ro' | 'rw'; purpose: string }>;
  networkPolicy: { mode: 'default-deny'; allowlist: string[] };
  lastTransitionReason?: string;
}

export interface LauncherHealth {
  status: 'ok' | 'degraded';
  launcherVersion: string;
  containerRuntimeReachable: boolean;
  notes: string[];
}

export function createLauncherClient(baseUrl: string, authToken?: string): LauncherClient {
  return new LauncherClient({ baseUrl, authToken: authToken || '' });
}

export class LauncherClient {
  private client: AxiosInstance;

  constructor(config: LauncherClientConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout || 30000,
      headers: {
        'Authorization': config.authToken ? `Bearer ${config.authToken}` : undefined,
        'Content-Type': 'application/json'
      }
    });
  }

  public async getHealth(): Promise<LauncherHealth> {
    const response: AxiosResponse<LauncherHealth> = await this.client.get('/health');
    return response.data;
  }

  public async provisionRuntime(request: ProvisionRequest): Promise<ProvisionResponse> {
    const response: AxiosResponse<ProvisionResponse> = await this.client.post('/agents', request);
    return response.data;
  }

  public async inspectRuntime(agentId: string): Promise<RuntimeStatus> {
    const response: AxiosResponse<RuntimeStatus> = await this.client.get(`/agents/${agentId}`);
    return response.data;
  }

  public async restartRuntime(agentId: string): Promise<RuntimeStatus> {
    const response: AxiosResponse<RuntimeStatus> = await this.client.post(`/agents/${agentId}/restart`);
    return response.data;
  }

  public async teardownRuntime(agentId: string): Promise<void> {
    await this.client.delete(`/agents/${agentId}`);
  }
}
