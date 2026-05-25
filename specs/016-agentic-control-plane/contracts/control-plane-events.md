# Control Plane Live Update Contract

## Channel
- **Transport**: WebSocket
- **Purpose**: Stream operator-facing goal and delegation updates without requiring
  manual refresh

## Subscription Model
The client subscribes to Prime control-plane updates for the current operator
session. The server emits event envelopes as goal state changes occur.

## Event Envelope
```json
{
  "type": "goal.updated",
  "occurredAt": "2026-05-23T12:00:00Z",
  "goalId": "goal_123",
  "payload": {}
}
```

## Event Types

### `goal.created`
Emitted when a new goal is accepted by Prime.

Payload fields:
- `title`
- `status`
- `currentSummary`

### `goal.updated`
Emitted when Prime updates a goal summary, status, or risks.

Payload fields:
- `status`
- `currentSummary`
- `riskSummary`
- `resultSummary`

### `work-item.created`
Emitted when Prime creates delegated or direct work.

Payload fields:
- `workItemId`
- `assignedAgentRole`
- `domain`
- `title`
- `status`

### `work-item.updated`
Emitted when delegated work changes state.

Payload fields:
- `workItemId`
- `status`
- `decisionSummary`
- `outcomeSummary`
- `failureReason`

### `approval.requested`
Emitted when execution pauses for operator approval.

Payload fields:
- `approvalId`
- `actionSummary`
- `riskSummary`
- `expiresAt`

### `approval.resolved`
Emitted when an approval is approved, rejected, expired, or cancelled.

Payload fields:
- `approvalId`
- `status`
- `decisionNotes`

### `recovery.recorded`
Emitted when the system detects blocked work and records a recovery attempt or
escalation.

Payload fields:
- `recoveryEventId`
- `detectedCondition`
- `selectedAction`
- `resultStatus`
- `resultSummary`

### `learning-record.created`
Emitted when a completed or failed run stores reusable feedback.

Payload fields:
- `learningRecordId`
- `category`
- `signalType`
- `confidence`

### `goal.completed`
Emitted when a goal reaches a terminal successful state.

Payload fields:
- `status`
- `resultSummary`
- `followUpRequired`

## Client Expectations
- The client treats Prime as the single user-facing narrator of progress.
- The client merges events into durable goal detail fetched through the API.
- The client shows loading, empty, success, and error states consistently while the
  connection is establishing, live, interrupted, or restored.

## Server Expectations
- Events are emitted only for the authenticated operator's single-tenant scope.
- Each event references a durable goal identifier.
- Connection interruptions do not become the source of truth; the client can always
  recover full state from the HTTP goal detail endpoint.
