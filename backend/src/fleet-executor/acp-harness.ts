import type pg from 'pg';
import { EventEmitter } from 'events';
import { AcpClient } from '../acp/client.js';
import { updateMapper, mapTaskEnd } from '../acp/update-mapper.js';
import { FsHandler } from '../acp/fs-handler.js';
import { PermissionPolicy, type PermissionConfig } from '../acp/permission.js';
import { updateAgent } from '../registry.js';
import type { AgentHarness, HarnessEvent, ModelRef, TaskHandle, TaskPrompt, TaskResult, WakeResult } from './harness.js';

export class AcpHarness implements AgentHarness {
  private client: AcpClient | null = null;
  private fsHandler: FsHandler | null = null;
  private permissionPolicy: PermissionPolicy;
  private sessionId: string | null = null;
  private eventEmitter = new EventEmitter();
  private promptPromise: Promise<any> | null = null;
  private currentDelegationId: string | null = null;
  private supportsLoadSession = false;

  constructor(
    private agentId: string,
    private pool: pg.Pool,
    private command: string,
    private args: string[] = [],
    private workspaceRoot: string,
    private permissionConfig: PermissionConfig = {},
  ) {
    this.permissionPolicy = new PermissionPolicy(this.pool);
  }

  async start(opts: { cwd: string; model: ModelRef }): Promise<void> {
    this.fsHandler = new FsHandler(this.workspaceRoot);

    this.client = new AcpClient(
      {
        command: this.command,
        args: this.args,
        cwd: opts.cwd,
      },
      {
        onSessionUpdate: (update) => {
          this.eventEmitter.emit('sessionUpdate', update);
        },
        onRequestPermission: async (req) => {
          return this.permissionPolicy.resolvePermission(req, {
            agentId: this.agentId,
            sessionId: this.sessionId!,
            delegationId: this.currentDelegationId ?? undefined,
            config: this.permissionConfig,
          });
        },
        onFsReadTextFile: async (req) => {
          // v0.12.0 uses { sessionId, path } for fs/read_text_file
          return this.fsHandler!.readTextFile(req.path);
        },
        onFsWriteTextFile: async (req) => {
          // v0.12.0 uses { sessionId, path, content } for fs/write_text_file
          await this.fsHandler!.writeTextFile(req.path, req.content);
        },
      }
    );

    await this.client.start();

    try {
      const initResult = await this.client.initialize({
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: false,
        },
        clientInfo: { name: 'primeloop', version: '0.1.0' },
      });

      // Capability reconciliation — derive a stable string list from the structured
      // AgentCapabilities object and persist it back to the registry as a routing hint.
      // Note: v0.12.0 may not have agentCapabilities in the response; skip if missing.
      const caps = (initResult as any).agentCapabilities;
      if (caps) {
        const negotiatedCapabilities: string[] = []
        if (caps.auth?.logout)             negotiatedCapabilities.push('auth')
        if (caps.loadSession)              { negotiatedCapabilities.push('load_session'); this.supportsLoadSession = true }
        if (caps.mcpCapabilities)          negotiatedCapabilities.push('mcp')
        if (caps.promptCapabilities?.image) negotiatedCapabilities.push('prompt_image')
        if (caps.promptCapabilities?.audio) negotiatedCapabilities.push('prompt_audio')
        if (caps.sessionCapabilities)      negotiatedCapabilities.push('session')
        await updateAgent(this.pool, this.agentId, { capabilities: negotiatedCapabilities })
      }

      await this.recordRuntimeEvent('acp.session.started', {
        agent_id: this.agentId,
        payload: { protocol_version: initResult.protocolVersion },
      });
    } catch (error) {
      await this.recordRuntimeEvent('acp.session.failed', {
        agent_id: this.agentId,
        payload: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  async dispatch(prompt: TaskPrompt): Promise<TaskHandle> {
    if (!this.client) throw new Error('AcpHarness not started');

    const taskId = crypto.randomUUID();
    this.currentDelegationId = taskId;

    if (!this.sessionId) {
      const newSessionResult = await this.client.sessionNew({
        cwd: this.workspaceRoot,
        mcpServers: [],
      });
      this.sessionId = newSessionResult.sessionId;
    }

    let resolveDone!: (r: TaskResult) => void;
    let rejectDone!: (e: Error) => void;
    const done = new Promise<TaskResult>((res, rej) => {
      resolveDone = res;
      rejectDone = rej;
    });

    const currentSessionId = this.sessionId;
    let finalText = '';
    let tokens = 0;

    // Queue bridges the EventEmitter notifications into the async generator below.
    const eventQueue: { event: HarnessEvent | 'DONE' | 'ERROR'; error?: Error }[] = [];
    let resolveQueue: (() => void) | null = null;

    const enqueue = (item: typeof eventQueue[number]) => {
      eventQueue.push(item);
      if (resolveQueue) {
        resolveQueue();
        resolveQueue = null;
      }
    };

    this.eventEmitter.on('sessionUpdate', (update: any) => {
      const event = updateMapper(update);
      if (event) {
        if (event.type === 'message_update') {
          finalText += event.delta;
        }
        enqueue({ event });
      }
    });

    this.eventEmitter.on('close', () => {
      enqueue({ event: 'ERROR', error: new Error('ACP process closed unexpectedly') });
    });

    this.promptPromise = this.client.sessionPrompt({
      sessionId: currentSessionId,
      prompt: [{ type: 'text', text: prompt.text }],
    }).then((result) => {
      const taskResult = mapTaskEnd(result.stopReason, finalText, tokens);
      
      if (result.stopReason === 'cancelled') {
        void this.recordRuntimeEvent('acp.session.cancelled', {
          agent_id: this.agentId,
          delegation_id: taskId,
          payload: { session_id: currentSessionId },
        });
      } else {
        void this.recordRuntimeEvent('acp.session.completed', {
          agent_id: this.agentId,
          delegation_id: taskId,
          payload: { session_id: currentSessionId, stop_reason: result.stopReason },
        });
      }

      enqueue({ event: 'DONE' });
      resolveDone(taskResult);
    }).catch((error) => {
      const errorMsg = error instanceof Error ? error.message : String(error);
      void this.recordRuntimeEvent('acp.session.failed', {
        agent_id: this.agentId,
        delegation_id: taskId,
        payload: { session_id: currentSessionId, error: errorMsg },
      });
      enqueue({ event: 'ERROR', error: new Error(errorMsg) });
      rejectDone(new Error(errorMsg));
    });

    async function* generateEvents(): AsyncIterable<HarnessEvent> {
      yield { type: 'task_start' };

      while (true) {
        if (eventQueue.length > 0) {
          const item = eventQueue.shift()!;
          if (item.event === 'DONE') {
            return;
          }
          if (item.event === 'ERROR') {
            throw item.error || new Error('Unknown error in ACP session');
          }
          yield item.event;
        } else {
          await new Promise<void>((resolve) => {
            resolveQueue = resolve;
          });
        }
      }
    }

    return { id: taskId, events: generateEvents(), done };
  }

  async wake(sessionId: string): Promise<WakeResult> {
    // Re-attach to a prior session after a restart (US1). Native ACP reload when the
    // agent supports it; otherwise signal the caller to re-dispatch from the checkpoint.
    if (!this.client) return { outcome: 'redispatched', reason: 'harness_not_started' };
    if (!this.supportsLoadSession) return { outcome: 'redispatched', reason: 'load_session_unsupported' };
    try {
      await this.client.sessionLoad({ sessionId });
      this.sessionId = sessionId;
      await this.recordRuntimeEvent('acp.session.resumed', {
        agent_id: this.agentId,
        payload: { session_id: sessionId },
      });
      return { outcome: 'resumed' };
    } catch (error) {
      await this.recordRuntimeEvent('acp.session.resume_failed', {
        agent_id: this.agentId,
        payload: { session_id: sessionId, error: error instanceof Error ? error.message : String(error) },
      });
      return { outcome: 'redispatched', reason: 'load_session_failed' };
    }
  }

  async abort(taskId: string): Promise<void> {
    this.currentDelegationId = null;
    
    // 1. Cancel any pending permissions immediately so they don't block the task settlement
    if (this.sessionId) {
      this.permissionPolicy.cancelPendingPermissions(this.agentId, this.sessionId, taskId);
    }
    
    // 2. Send cancel to the agent (ignore errors if the process already crashed or closed)
    if (this.client && this.sessionId) {
      try {
        await this.client.sessionCancel(this.sessionId);
      } catch {
        // Process may have already crashed or closed; proceed to cleanup
      }
      
      await this.recordRuntimeEvent('acp.session.cancelled', {
        agent_id: this.agentId,
        delegation_id: taskId,
        payload: { session_id: this.sessionId },
      });
    }
  }

  async close(): Promise<void> {
    // Unconditionally reap the subprocess to prevent orphans (SC-005)
    if (this.client) {
      try {
        await this.client.terminate();
      } catch {
        // Ignore termination errors if the process is already dead
      }
      this.client = null;
    }
    this.sessionId = null;
    this.currentDelegationId = null;
  }

  private async recordRuntimeEvent(
    eventType: string,
    event: { agent_id: string; delegation_id?: string; payload: Record<string, unknown> },
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO runtime_events (event_type, actor, delegation_id, payload)
       VALUES ($1, $2, $3, $4)`,
      [eventType, 'acp-harness', event.delegation_id ?? null, JSON.stringify({ agent_id: event.agent_id, ...event.payload })],
    );
  }
}
