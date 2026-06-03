import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Pool } from 'pg';

// Create a shared mock instance
const mockClientInstance = {
  start: vi.fn().mockResolvedValue(undefined),
  initialize: vi.fn().mockResolvedValue({ protocolVersion: 1, agentCapabilities: { fs: true } }),
  sessionNew: vi.fn().mockResolvedValue({ sessionId: 'test-session-1' }),
  sessionPrompt: vi.fn().mockResolvedValue({ stopReason: 'end_turn' }),
  sessionCancel: vi.fn().mockResolvedValue(undefined),
  terminate: vi.fn().mockResolvedValue(undefined),
  handlers: {} as any,
};

// Mock pg.Pool
vi.mock('pg', () => {
  return {
    Pool: vi.fn().mockImplementation(() => ({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    })),
  };
});

// Mock AcpClient
vi.mock('../../src/acp/client.js', () => {
  return {
    AcpClient: vi.fn().mockImplementation(() => mockClientInstance),
  };
});

// Import after mocking
import { AcpHarness } from '../../src/fleet-executor/acp-harness.js';

describe('AcpHarness Integration', () => {
  let harness: AcpHarness;
  let mockPool: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = new Pool();
    
    harness = new AcpHarness(
      'test-agent-id',
      mockPool,
      'acp-agent',
      [],
      '/tmp/test-workspace'
    );
  });

  afterEach(async () => {
    await harness.close();
    vi.clearAllMocks();
  });

  it('should start and reconcile capabilities', async () => {
    await harness.start({
      cwd: '/tmp/test-workspace',
      model: { providerID: 'openai', id: 'gpt-4' },
    });

    expect(mockClientInstance.initialize).toHaveBeenCalledWith({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
      clientInfo: { name: 'primeloop', version: '0.1.0' },
    });
    
    // Verify updateAgent was called. The mock returns { agentCapabilities: { fs: true } }
    // which has no recognised structured capability keys, so the reconciled list is empty.
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE agents SET capabilities'),
      expect.arrayContaining(['test-agent-id', '[]'])
    );
  });

  it('should dispatch and return a task handle', async () => {
    await harness.start({
      cwd: '/tmp/test-workspace',
      model: { providerID: 'openai', id: 'gpt-4' },
    });

    const handle = await harness.dispatch({
      text: 'Do something',
      allowed_files: [],
      read_files: [],
    });

    expect(handle.id).toBeDefined();
    expect(handle.events).toBeDefined();
    expect(handle.done).toBeDefined();
    
    expect(mockClientInstance.sessionNew).toHaveBeenCalledWith({
      cwd: '/tmp/test-workspace',
      mcpServers: [],
    });
    
    expect(mockClientInstance.sessionPrompt).toHaveBeenCalledWith({
      sessionId: 'test-session-1',
      prompt: [{ type: 'text', text: 'Do something' }],
    });
  });

  it('should handle abort correctly', async () => {
    await harness.start({
      cwd: '/tmp/test-workspace',
      model: { providerID: 'openai', id: 'gpt-4' },
    });

    const handle = await harness.dispatch({
      text: 'Do something long',
      allowed_files: [],
      read_files: [],
    });

    await harness.abort(handle.id);

    expect(mockClientInstance.sessionCancel).toHaveBeenCalledWith('test-session-1');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO runtime_events'),
      expect.arrayContaining(['acp.session.cancelled', 'acp-harness', handle.id, expect.any(String)])
    );
  });

  it('should handle crash-before-cancel gracefully in abort', async () => {
    await harness.start({
      cwd: '/tmp/test-workspace',
      model: { providerID: 'openai', id: 'gpt-4' },
    });

    const handle = await harness.dispatch({
      text: 'Do something',
      allowed_files: [],
      read_files: [],
    });

    // Simulate crash by clearing the client
    (harness as any).client = null;

    // abort should not throw even if client is null
    await expect(harness.abort(handle.id)).resolves.not.toThrow();
    
    // close should also be safe
    await expect(harness.close()).resolves.not.toThrow();
  });

  it('should handle cancel-during-permission-wait', async () => {
    // Mock the permission policy to simulate a pending permission
    const mockCancelPending = vi.fn();
    (harness as any).permissionPolicy.cancelPendingPermissions = mockCancelPending;

    await harness.start({
      cwd: '/tmp/test-workspace',
      model: { providerID: 'openai', id: 'gpt-4' },
    });

    const handle = await harness.dispatch({
      text: 'Do something requiring permission',
      allowed_files: [],
      read_files: [],
    });

    await harness.abort(handle.id);

    expect(mockCancelPending).toHaveBeenCalledWith(
      'test-agent-id',
      'test-session-1',
      handle.id
    );
    expect(mockClientInstance.sessionCancel).toHaveBeenCalledWith('test-session-1');
  });
});
