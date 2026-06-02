# API Contract: Chat Composer Controls

**Feature**: Chat Composer Controls  
**Branch**: `main` | **Date**: 2026-06-01

## Overview

This document defines the interface contracts for the chat composer feature. The composer is purely a frontend concern and does not introduce new backend endpoints. It reuses existing message delivery infrastructure.

## Frontend Contracts

### Composer State

The composer maintains local state for the draft message:

```typescript
interface ComposerState {
  text: string;
  modelId: string | null;
  mode: 'planning' | 'agent';
  attachments: Attachment[];
  companionPrompt: string | null;
  tools: ToolConfig;
}
```

### Send Request

When the operator sends a message, the frontend constructs a request payload:

```typescript
interface SendRequest {
  text: string;
  modelId: string;
  mode: 'planning' | 'agent';
  attachments: AttachmentMetadata[];
  companionPrompt: string | null;
  tools: ToolConfig;
}
```

### Validation Response

The frontend validates the composer state before sending:

```typescript
interface ValidationError {
  error: 'validation_failed';
  message: string;
  fields: ('text' | 'attachments' | 'companionPrompt')[];
}
```

## Backend Contracts (Existing)

### Message Delivery Endpoint

The composer reuses the existing message delivery endpoint:

**Endpoint**: `POST /api/messages`  
**Authentication**: Required (session token)  
**Request Body**: Standard message payload with added fields

```typescript
interface MessagePayload {
  room_id: string;
  text: string;
  model_id: string;
  mode: 'planning' | 'agent';
  companion_prompt?: string | null;
  tools?: ToolConfig;
}

interface AttachmentMetadata {
  id: string;
  name: string;
  type: 'file' | 'image';
  mime_type: string;
  size: number;
}
```

### Success Response

```typescript
interface MessageSuccess {
  success: boolean;
  message_id: string;
  session_id: string;
}
```

### Error Response

```typescript
interface MessageError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}
```

## UI Contract

### Composer Controls

The composer exposes the following interactive elements:

| Control | Type | State |
|---------|------|-------|
| Text input | `<input>` | `value`, `placeholder`, `disabled` |
| Model selector | `<select>` or chip group | `selectedId`, `options[]` |
| Mode toggle | Toggle button or switch | `activeMode: 'planning' \| 'agent'` |
| Attachment button | `<button>` | `count`, `disabled` |
| Companion prompt input | `<textarea>` or inline field | `value`, `placeholder` |
| Tool toggles | Checkbox or toggle chips | `enabled[]`, `disabled[]` |
| Send button | `<button>` | `disabled`, `loading` |

### Status Messages

The composer displays status messages for:

- **Idle**: Placeholder text `<prime>...`
- **Sending**: Loading indicator on send button
- **Success**: Clear success state, composer resets
- **Error**: Inline error message with corrective guidance

## Event Contract

### Composer Events

```typescript
type ComposerEvent =
  | { type: 'text_change'; text: string }
  | { type: 'model_select'; modelId: string }
  | { type: 'mode_toggle'; mode: 'planning' | 'agent' }
  | { type: 'attachment_add'; attachment: Attachment }
  | { type: 'attachment_remove'; id: string }
  | { type: 'companion_prompt_change'; prompt: string }
  | { type: 'tool_toggle'; tool: keyof ToolConfig; enabled: boolean }
  | { type: 'send_attempt' }
  | { type: 'send_success'; messageId: string; sessionId: string }
  | { type: 'send_error'; error: string };
```

### Validation Events

```typescript
type ValidationEvent =
  | { type: 'validation_start' }
  | { type: 'validation_pass' }
  | { type: 'validation_fail'; errors: ValidationError[] };
```
