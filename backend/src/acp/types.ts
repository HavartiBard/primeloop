/**
 * ACP (Agent Client Protocol) local type re-exports and project-specific narrow types.
 *
 * Note: @agentclientprotocol/sdk v0.12.0 exports methods in AGENT_METHODS/CLIENT_METHODS objects
 * rather than as named types. This file provides the correct type aliases for the protocol.
 */

import type { AGENT_METHODS, CLIENT_METHODS } from '@agentclientprotocol/sdk';

// Extract method names from the SDK's method lists
export type InitializeMethod = typeof AGENT_METHODS.initialize;
export type SessionNewMethod = typeof AGENT_METHODS.session_new;
export type SessionPromptMethod = typeof AGENT_METHODS.session_prompt;
export type SessionCancelMethod = typeof AGENT_METHODS.session_cancel;
export type SessionUpdateMethod = typeof CLIENT_METHODS.session_update;
export type SessionRequestPermissionMethod = typeof CLIENT_METHODS.session_request_permission;
export type FsReadTextFileMethod = typeof CLIENT_METHODS.fs_read_text_file;
export type FsWriteTextFileMethod = typeof CLIENT_METHODS.fs_write_text_file;

export interface AcpSessionState {
  sessionId: string;
  status: 'initializing' | 'ready' | 'prompting' | 'waiting_permission' | 'completed' | 'failed' | 'cancelled';
  pendingPermissionId?: string;
}
