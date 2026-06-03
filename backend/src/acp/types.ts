/**
 * ACP (Agent Client Protocol) local type re-exports and project-specific narrow types.
 */

export type { InitializeRequest, InitializeResult, SessionNewRequest, SessionNewResult, SessionPromptRequest, SessionPromptResult, SessionUpdateNotification, SessionRequestPermissionRequest, SessionRequestPermissionResult, FsReadTextFileRequest, FsReadTextFileResult, FsWriteTextFileRequest, FsWriteTextFileResult } from '@agentclientprotocol/sdk';

export interface AcpSessionState {
  sessionId: string;
  status: 'initializing' | 'ready' | 'prompting' | 'waiting_permission' | 'completed' | 'failed' | 'cancelled';
  pendingPermissionId?: string;
}
