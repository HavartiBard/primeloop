import { WebSocket } from 'ws';

// Event envelope per control-plane-events.md
export interface ControlPlaneEvent {
  type: string;
  occurredAt: string; // ISO timestamp
  goalId?: string;
  payload: Record<string, unknown>;
}

// All supported event types (from contract)
export const CONTROL_PLANE_EVENT_TYPES = [
  'goal.created',
  'goal.updated',
  'work-item.created',
  'work-item.updated',
  'approval.requested',
  'approval.resolved',
  'recovery.recorded',
  'learning-record.created',
  'goal.completed',
] as const;

// In-memory subscriber store (single-tenant)
const subscribers = new Set<WebSocket>();

export function broadcastEvent(event: ControlPlaneEvent): void {
  const data = JSON.stringify(event);
  for (const ws of subscribers) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

export function broadcastApprovalRequested(payload: Record<string, unknown>, goalId?: string): void {
  broadcastEvent({
    type: 'approval.requested',
    occurredAt: new Date().toISOString(),
    goalId,
    payload,
  });
}

export function broadcastApprovalResolved(payload: Record<string, unknown>, goalId?: string): void {
  broadcastEvent({
    type: 'approval.resolved',
    occurredAt: new Date().toISOString(),
    goalId,
    payload,
  });
}

export function subscribeToControlPlaneEvents(ws: WebSocket): void {
  subscribers.add(ws);
  ws.on('close', () => {
    subscribers.delete(ws);
  });
}

export function unsubscribeFromControlPlaneEvents(ws: WebSocket): void {
  subscribers.delete(ws);
}
