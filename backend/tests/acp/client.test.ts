import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock child_process at the top level
const mockStdin = { write: vi.fn() };
const mockStdout = new EventEmitter();
const mockStderr = new EventEmitter();
const mockProcess: any = {
  stdin: mockStdin,
  stdout: mockStdout,
  stderr: mockStderr,
  closeCb: null as any,
  errorCb: null as any,
  kill: vi.fn(),
};

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    mockProcess.on = (event: string, cb: any) => {
      if (event === 'close') mockProcess.closeCb = cb;
      if (event === 'error') mockProcess.errorCb = cb;
    };
    return mockProcess;
  }),
}));

import { AcpClient } from '../../src/acp/client.js';

describe('AcpClient', () => {
  let client: AcpClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStdin.write.mockClear();
    client = new AcpClient({ command: 'mock-agent', cwd: '/tmp' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts the subprocess', async () => {
    await client.start();
    const { spawn } = await import('child_process');
    expect(spawn).toHaveBeenCalledWith('mock-agent', [], expect.objectContaining({
      cwd: '/tmp',
      stdio: ['pipe', 'pipe', 'pipe'],
    }));
  });

  it('sends initialize request and parses response', async () => {
    await client.start();
    
    const initPromise = client.initialize({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
      clientInfo: { name: 'test', version: '1.0' },
    });

    // Simulate agent response
    const response = {
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: 1, agentCapabilities: { fs: true } },
    };
    mockStdout.emit('data', Buffer.from(JSON.stringify(response) + '\n'));

    const result = await initPromise;
    expect(result).toEqual({ protocolVersion: 1, agentCapabilities: { fs: true } });
  });

  it('handles session/update notifications', async () => {
    const onUpdate = vi.fn();
    client = new AcpClient({ command: 'mock-agent', cwd: '/tmp' }, { onSessionUpdate: onUpdate });
    await client.start();

    const notification = {
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: 's1', update: { type: 'agent_message_chunk', text: 'hi' } },
    };
    mockStdout.emit('data', Buffer.from(JSON.stringify(notification) + '\n'));

    expect(onUpdate).toHaveBeenCalledWith({ sessionId: 's1', update: { type: 'agent_message_chunk', text: 'hi' } });
  });

  it('handles fs/read_text_file callback', async () => {
    const onRead = vi.fn().mockResolvedValue({ content: 'file content' });
    client = new AcpClient({ command: 'mock-agent', cwd: '/tmp' }, { onFsReadTextFile: onRead });
    await client.start();

    const request = {
      jsonrpc: '2.0',
      id: 5,
      method: 'fs/read_text_file',
      params: { sessionId: 's1', path: '/test.txt' },
    };
    mockStdout.emit('data', Buffer.from(JSON.stringify(request) + '\n'));

    await new Promise(r => setTimeout(r, 10));

    expect(onRead).toHaveBeenCalledWith({ sessionId: 's1', path: '/test.txt' });
    expect(mockStdin.write).toHaveBeenCalledWith(expect.stringContaining('"id":5'));
    expect(mockStdin.write).toHaveBeenCalledWith(
      expect.stringContaining('"result":{"content":"file content"}')
    );
  });

  it('returns JSON-RPC error when fs/read_text_file handler is not registered', async () => {
    // no onFsReadTextFile handler
    client = new AcpClient({ command: 'mock-agent', cwd: '/tmp' }, {});
    await client.start();

    const request = { jsonrpc: '2.0', id: 6, method: 'fs/read_text_file', params: { sessionId: 's1', path: '/test.txt' } };
    mockStdout.emit('data', Buffer.from(JSON.stringify(request) + '\n'));

    await new Promise(r => setTimeout(r, 10));

    expect(mockStdin.write).toHaveBeenCalledWith(expect.stringContaining('"error"'));
    expect(mockStdin.write).toHaveBeenCalledWith(expect.stringContaining('"id":6'));
  });

  it('rejects in-flight requests when session is cancelled', async () => {
    await client.start();

    // Simulate a successful initialize response so state is set
    const initPromise = client.initialize({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
      clientInfo: { name: 'test', version: '1.0' },
    });
    mockStdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1, agentCapabilities: {} } }) + '\n'));
    await initPromise;

    // Queue a session/prompt (will park in pendingRequests — no response simulated)
    const promptPromise = client.sessionPrompt({ sessionId: 's1', prompt: [{ type: 'text', text: 'go' }] } as any);

    await client.sessionCancel('s1');

    await expect(promptPromise).rejects.toThrow('Session cancelled');
  });

  it('rejects pending requests on process close', async () => {
    await client.start();

    const initPromise = client.initialize({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true } },
      clientInfo: { name: 'test', version: '1.0' },
    });

    // Simulate process crash
    mockProcess.closeCb(1, 'SIGTERM');

    await expect(initPromise).rejects.toThrow('Process exited with code 1 and signal SIGTERM');
  });

  // spec 025 T016: remote ACP transport over HTTP
  describe('remote HTTP transport', () => {
    const endpoint = { protocol: 'http' as const, host: 'launcher-agent-1', port: 8080, path: '/acp' };
    let fetchMock: ReturnType<typeof vi.fn>;
    let remoteClient: AcpClient;

    beforeEach(() => {
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      remoteClient = new AcpClient({ command: 'unused', cwd: '/tmp' });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('does not spawn a subprocess for remote transport', async () => {
      await remoteClient.startRemote(endpoint);
      const { spawn } = await import('child_process');
      expect(spawn).not.toHaveBeenCalled();
    });

    it('sends requests over HTTP to the remote endpoint and resolves the response', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } }),
      });

      await remoteClient.startRemote(endpoint);
      const result = await remoteClient.initialize({
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true } },
        clientInfo: { name: 'test', version: '1.0' },
      });

      expect(result.protocolVersion).toBe(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://launcher-agent-1:8080/acp',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('rejects when the remote endpoint returns a non-ok status', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => 'Bad Gateway',
      });

      await remoteClient.startRemote(endpoint);
      await expect(
        remoteClient.initialize({
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: 'test', version: '1.0' },
        }),
      ).rejects.toThrow(/502/);
    });

    it('rejects sending a request before the remote endpoint is configured', async () => {
      const bareClient = new AcpClient({ command: 'unused', cwd: '/tmp' });
      // Force remote mode without configuring an endpoint to assert the guard.
      ;(bareClient as unknown as { transport: string }).transport = 'http';
      await expect(
        bareClient.initialize({ protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 't', version: '1' } }),
      ).rejects.toThrow(/Remote endpoint not configured/);
    });
  });
});
