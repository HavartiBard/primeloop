# Data Model: Chat Composer Controls

**Feature**: Chat Composer Controls  
**Branch**: `020-chat-composer-controls` | **Date**: 2026-06-01

## Entities

### Chat Draft

Represents the in-progress message being composed before send.

**Fields**:
- `text`: string — Main message body (can be empty if attachments or companion prompt present)
- `modelId`: string | null — Selected agent model identifier
- `mode`: "planning" | "agent" — Execution mode selected by operator
- `attachments`: Attachment[] — Array of attached files/images
- `companionPrompt`: string | null — Optional extra instructions
- `tools`: ToolConfig — Enabled/disabled tool categories
- `validationState`: "valid" | "invalid" | "pending" — Current validation status
- `sendState`: "idle" | "sending" | "success" | "error" — Send operation state

**Validation Rules**:
- If `text` is empty, at least one of `attachments` or `companionPrompt` must be present.
- `modelId` must be a known model identifier from product configuration.
- `mode` must be either "planning" or "agent".
- Each attachment must pass size and type validation (configurable policy).
- `tools` must be a valid configuration from product policy.

**State Transitions**:
- `validationState`: idle → pending (on send attempt) → valid/invalid (after validation)
- `sendState`: idle → sending (on send initiation) → success/error (on completion)

---

### Attachment

Represents a file or image attached to a draft.

**Fields**:
- `id`: string — Unique identifier
- `name`: string — Original filename
- `type`: "file" | "image" — Attachment type
- `mimeType`: string — MIME type (e.g., "image/png", "text/plain")
- `size`: number — File size in bytes
- `uploadState`: "pending" | "uploading" | "uploaded" | "failed" — Upload status

**Validation Rules**:
- `size` must not exceed maximum configured attachment size.
- `mimeType` must be an allowed type per product policy.

---

### ToolConfig

Represents enabled/disabled tool categories for a message.

**Fields**:
- `webSearch`: boolean — Enable/disable web search capability
- `shell`: boolean — Enable/disable shell access capability
- `imageProcessing`: boolean — Enable/disable image processing capability

**Validation Rules**:
- All fields must be present (boolean).
- Tool availability may be constrained by product policy or selected model.

---

### ModelOption

Represents a selectable agent model choice presented to the operator.

**Fields**:
- `id`: string — Unique identifier
- `name`: string — Display name
- `provider`: string — Provider name (e.g., "anthropic", "openai")
- `availableModes`: ("planning" | "agent")[] — Modes supported by this model

**Relationships**:
- One-to-many with Chat Draft: A draft selects one ModelOption.

---

### ExecutionMode

Represents the operator-selected run style for a message.

**Fields**:
- `id`: "planning" | "agent"
- `description`: string — Human-readable description
- `defaultTools`: ToolConfig — Default tool configuration for this mode

**Relationships**:
- One-to-many with Chat Draft: A draft selects one ExecutionMode.

---

## API Contracts

### Composer State Payload (to backend on send)

```json
{
  "text": "string",
  "modelId": "string",
  "mode": "planning" | "agent",
  "attachments": [
    {
      "id": "string",
      "name": "string",
      "type": "file" | "image",
      "mimeType": "string",
      "size": 0
    }
  ],
  "companionPrompt": "string | null",
  "tools": {
    "webSearch": true,
    "shell": false,
    "imageProcessing": true
  }
}
```

### Validation Error Response

```json
{
  "error": "validation_failed",
  "message": "At least one of text, attachment, or companion prompt is required.",
  "fields": ["text", "attachments", "companionPrompt"]
}
```

### Send Success Response

```json
{
  "success": true,
  "messageId": "string",
  "sessionId": "string"
}
```

## State Diagrams

### Composer Draft Flow

```
[Empty] --(user types)--> [Editing]
[Empty] --(attach file)--> [Editing]
[Editing] --(attach image)--> [Editing]
[Editing] --(add companion prompt)--> [Editing]
[Editing] --(remove all inputs)--> [Empty]
[Editing] --(send)--> [Validating] --> [Valid] or [Invalid]
[Valid] --(send)--> [Sending] --> [Success] or [Error]
[Error] --(user edits)--> [Editing]
[Success] --(next message)--> [Empty]
```

### Attachment Upload Flow

```
[Pending] --(start upload)--> [Uploading]
[Uploading] --(complete)--> [Uploaded]
[Uploading] --(fail)--> [Failed]
[Failed] --(retry)--> [Uploading]
[Uploaded] --(remove)--> [Removed]
```
