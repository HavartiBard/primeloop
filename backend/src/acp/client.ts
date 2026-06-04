import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import type { AcpSessionState } from './types.js';

// Method names from @agentclientprotocol/sdk v0.12.0
const METHOD_INITIALIZE = 'initialize';
const METHOD_SESSION_NEW = 'session/new';
const METHOD_SESSION_PROMPT = 'session/prompt';
const METHOD_SESSION_CANCEL = 'session/cancel';
const METHOD_SESSION_UPDATE = 'session/update';
const METHOD_SESSION_REQUEST_PERMISSION = 'session/request_permission';
const METHOD_FS_READ_TEXT_FILE = 'fs/read_text_file';
const METHOD_FS_WRITE_TEXT_FILE = 'fs/write_text_file';

export interface AcpClientOptions {
  command: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
}

export interface AcpClientHandlers {
  onSessionUpdate?: (update: { sessionId: string; update: any }) => void;
  onRequestPermission?: (req: { sessionId: string; toolCall: any; options: any[] }) => Promise<{ outcome: 'granted' | 'denied' }>;
  onFsReadTextFile?: (req: { sessionId: string; path: string }) => Promise<{ content: string }>;
  onFsWriteTextFile?: (req: { sessionId: string; path: string; content: string }) => Promise<void>;
}

export class AcpClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private messageId = 0;
  private pendingRequests = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private buffer = '';
  private state: AcpSessionState | null = null;

  constructor(private options: AcpClientOptions, private handlers: AcpClientHandlers = {}) {
    super();
  }

  public async start(): Promise<void> {
    if (this.process) {
      throw new Error('ACP client already started');
    }

    this.process = spawn(this.options.command, this.options.args || [], {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data: Buffer) => this.handleData(data.toString()));
    this.process.stderr?.on('data', (data: Buffer) => {
      this.emit('stderr', data.toString());
    });

    this.process.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      this.emit('close', { code, signal });
      this.rejectAllPending(new Error(`Process exited with code ${code} and signal ${signal}`));
    });

    this.process.on('error', (err: Error) => {
      this.emit('error', err);
      this.rejectAllPending(err);
    });
  }

  public async initialize(request: { protocolVersion: number; clientCapabilities: any; clientInfo: any }): Promise<{ protocolVersion: number }> {
    const result = await this.sendRequest<{ protocolVersion: number }>(METHOD_INITIALIZE, request);
    this.state = { sessionId: '', status: 'ready' };
    return result;
  }

  public async sessionNew(request: { cwd: string; mcpServers: any[] }): Promise<{ sessionId: string }> {
    if (!this.state) throw new Error('Client not initialized');
    const result = await this.sendRequest<{ sessionId: string }>(METHOD_SESSION_NEW, request);
    this.state.sessionId = result.sessionId;
    this.state.status = 'ready';
    return result;
  }

  public async sessionPrompt(request: { sessionId: string; prompt: any[] }): Promise<{ stopReason: string }> {
    if (!this.state) throw new Error('Client not initialized');
    this.state.status = 'prompting';
    return this.sendRequest<{ stopReason: string }>(METHOD_SESSION_PROMPT, request);
  }

  public async sessionCancel(sessionId: string): Promise<void> {
    await this.sendNotification(METHOD_SESSION_CANCEL, { sessionId });
    if (this.state) this.state.status = 'cancelled';
    this.rejectAllPending(new Error('Session cancelled'));
  }

  // Re-attach to a previously-created session (ACP `session/load`). Requires the
  // agent to advertise the load_session capability.
  public async sessionLoad(request: { sessionId: string }): Promise<void> {
    if (!this.state) throw new Error('Client not initialized');
    await this.sendRequest('session/load', request);
    this.state.sessionId = request.sessionId;
    this.state.status = 'ready';
  }

  public async terminate(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');
      // Give it a moment to gracefully exit, then force kill
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (this.process && !this.process.killed) {
        this.process.kill('SIGKILL');
      }
      this.process = null;
      this.state = null;
    }
  }

  private sendRequest<T>(method: string, params: any): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      this.pendingRequests.set(id, { resolve, reject });
      
      const message = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };
      
      this.writeMessage(message);
    });
  }

  private async sendNotification(method: string, params: any): Promise<void> {
    const message = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this.writeMessage(message);
  }

  private writeMessage(message: any): void {
    if (!this.process?.stdin) {
      throw new Error('Process stdin not available');
    }
    const json = JSON.stringify(message);
    this.process.stdin.write(`${json}\n`);
  }

  private handleData(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message = JSON.parse(trimmed);
        this.handleMessage(message);
      } catch (err) {
        this.emit('parse_error', { line: trimmed, error: err });
      }
    }
  }

  private handleMessage(message: any): void {
    if (message.id !== undefined && this.pendingRequests.has(message.id)) {
      const { resolve, reject } = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);

      if (message.error) {
        reject(new Error(message.error.message || 'JSON-RPC error'));
      } else {
        resolve(message.result);
      }
      return;
    }

    if (message.method === METHOD_SESSION_UPDATE) {
      this.handlers.onSessionUpdate?.(message.params);
      return;
    }

    if (message.method === METHOD_SESSION_REQUEST_PERMISSION) {
      // v0.12.0 passes { sessionId, toolCall, options }
      this.handleRequest(message.id, message.params, async () => {
        if (!this.handlers.onRequestPermission) return { outcome: 'denied' as const };
        return this.handlers.onRequestPermission({
          sessionId: message.params.sessionId,
          toolCall: message.params.toolCall,
          options: message.params.options,
        });
      });
      return;
    }

    if (message.method === METHOD_FS_READ_TEXT_FILE) {
      this.handleRequest(message.id, message.params, async () => {
        if (!this.handlers.onFsReadTextFile) {
          throw new Error('fs/read_text_file is not supported by this client');
        }
        return this.handlers.onFsReadTextFile(message.params);
      });
      return;
    }

    if (message.method === METHOD_FS_WRITE_TEXT_FILE) {
      this.handleRequest(message.id, message.params, async () => {
        if (!this.handlers.onFsWriteTextFile) {
          throw new Error('fs/write_text_file is not supported by this client');
        }
        return this.handlers.onFsWriteTextFile(message.params);
      });
      return;
    }
  }

  private async handleRequest(id: number, params: any, handler: () => Promise<any>): Promise<void> {
    try {
      const result = await handler();
      this.writeMessage({
        jsonrpc: '2.0',
        id,
        result,
      });
    } catch (error: any) {
      this.writeMessage({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: error.message || 'Internal error' },
      });
    }
  }

  private rejectAllPending(error: Error): void {
    for (const { reject } of this.pendingRequests.values()) {
      reject(error);
    }
    this.pendingRequests.clear();
  }
}
