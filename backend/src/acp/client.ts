import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import type {
  InitializeRequest,
  InitializeResult,
  SessionNewRequest,
  SessionNewResult,
  SessionPromptRequest,
  SessionPromptResult,
  SessionUpdateNotification,
  SessionRequestPermissionRequest,
  SessionRequestPermissionResult,
  FsReadTextFileRequest,
  FsReadTextFileResult,
  FsWriteTextFileRequest,
  FsWriteTextFileResult,
} from '@agentclientprotocol/sdk';
import type { AcpSessionState } from './types.js';

export interface AcpClientOptions {
  command: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
}

export interface AcpClientHandlers {
  onSessionUpdate?: (update: SessionUpdateNotification['params']) => void;
  onRequestPermission?: (req: SessionRequestPermissionRequest['params']) => Promise<SessionRequestPermissionResult>;
  onFsReadTextFile?: (req: FsReadTextFileRequest['params']) => Promise<FsReadTextFileResult>;
  onFsWriteTextFile?: (req: FsWriteTextFileRequest['params']) => Promise<FsWriteTextFileResult>;
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

  public async initialize(request: InitializeRequest['params']): Promise<InitializeResult> {
    const result = await this.sendRequest<InitializeResult>('initialize', request);
    this.state = { sessionId: '', status: 'ready' };
    return result;
  }

  public async sessionNew(request: SessionNewRequest['params']): Promise<SessionNewResult> {
    if (!this.state) throw new Error('Client not initialized');
    const result = await this.sendRequest<SessionNewResult>('session/new', request);
    this.state.sessionId = result.sessionId;
    this.state.status = 'ready';
    return result;
  }

  public async sessionPrompt(request: SessionPromptRequest['params']): Promise<SessionPromptResult> {
    if (!this.state) throw new Error('Client not initialized');
    this.state.status = 'prompting';
    return this.sendRequest<SessionPromptResult>('session/prompt', request);
  }

  public async sessionCancel(sessionId: string): Promise<void> {
    await this.sendNotification('session/cancel', { sessionId });
    if (this.state) this.state.status = 'cancelled';
    this.rejectAllPending(new Error('Session cancelled'));
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

    if (message.method === 'session/update') {
      this.handlers.onSessionUpdate?.(message.params);
      return;
    }

    if (message.method === 'session/request_permission') {
      this.handleRequest(message.id, message.params, async () => {
        if (!this.handlers.onRequestPermission) return { outcome: 'cancelled' as const };
        return this.handlers.onRequestPermission(message.params);
      });
      return;
    }

    if (message.method === 'fs/read_text_file') {
      this.handleRequest(message.id, message.params, async () => {
        if (!this.handlers.onFsReadTextFile) {
          throw new Error('fs/read_text_file is not supported by this client');
        }
        return this.handlers.onFsReadTextFile(message.params);
      });
      return;
    }

    if (message.method === 'fs/write_text_file') {
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
