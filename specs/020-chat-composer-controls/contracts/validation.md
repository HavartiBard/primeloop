# Validation Contract: Chat Composer Controls

**Feature**: Chat Composer Controls  
**Branch**: `main` | **Date**: 2026-06-01

## Overview

This document defines the validation rules for the chat composer. Validation occurs client-side before sending to ensure the operator's configuration is valid.

## Validation Rules

### Rule: At Least One Input Required

**Rule ID**: `INPUT_REQUIRED`  
**Severity**: Error

**Description**: The composer must have at least one of: text, attachment, or companion prompt.

**Validation Logic**:
```typescript
function validateInputRequired(state: ComposerState): boolean {
  return (
    state.text.trim().length > 0 ||
    state.attachments.length > 0 ||
    state.companionPrompt !== null
  );
}
```

**Error Message**: "At least one of text, attachment, or companion prompt is required."

---

### Rule: Valid Model Selection

**Rule ID**: `VALID_MODEL`  
**Severity**: Error

**Description**: The selected model must be a known model from product configuration.

**Validation Logic**:
```typescript
function validateModel(state: ComposerState, availableModels: ModelOption[]): boolean {
  if (!state.modelId) return false;
  return availableModels.some(m => m.id === state.modelId);
}
```

**Error Message**: "Selected model is not available. Please choose a different model."

---

### Rule: Valid Mode Selection

**Rule ID**: `VALID_MODE`  
**Severity**: Error

**Description**: The selected mode must be either 'planning' or 'agent'.

**Validation Logic**:
```typescript
function validateMode(state: ComposerState): boolean {
  return state.mode === 'planning' || state.mode === 'agent';
}
```

**Error Message**: "Invalid execution mode. Please select 'planning' or 'agent'."

---

### Rule: Attachment Size

**Rule ID**: `ATTACHMENT_SIZE`  
**Severity**: Error

**Description**: Each attachment must not exceed the maximum configured size.

**Validation Logic**:
```typescript
function validateAttachmentSize(state: ComposerState, maxSizeBytes: number): boolean {
  return state.attachments.every(a => a.size <= maxSizeBytes);
}
```

**Error Message**: "One or more attachments exceed the maximum size limit. Please remove large files."

---

### Rule: Attachment Type

**Rule ID**: `ATTACHMENT_TYPE`  
**Severity**: Error

**Description**: Each attachment must be of an allowed type per product policy.

**Validation Logic**:
```typescript
function validateAttachmentType(state: ComposerState, allowedTypes: string[]): boolean {
  return state.attachments.every(a => allowedTypes.includes(a.mimeType));
}
```

**Error Message**: "One or more attachments have unsupported file types. Please select different files."

---

### Rule: Tool Availability

**Rule ID**: `TOOL_AVAILABLE`  
**Severity**: Warning (non-blocking)

**Description**: Selected tools must be available for the chosen model and mode.

**Validation Logic**:
```typescript
function validateToolAvailability(
  state: ComposerState,
  availableTools: ToolConfig
): boolean {
  return (
    (!state.tools.webSearch || availableTools.webSearch) &&
    (!state.tools.shell || availableTools.shell) &&
    (!state.tools.imageProcessing || availableTools.imageProcessing)
  );
}
```

**Warning Message**: "Some selected tools may not be available for this model or mode."

---

## Validation Flow

### Client-Side Validation

1. Operator clicks "Send" button
2. Frontend runs all validation rules
3. If any rule fails:
   - Show error message inline
   - Preserve draft content and selections
   - Do not send to backend
4. If all rules pass:
   - Proceed to send

### Server-Side Validation (Fallback)

The backend performs its own validation as a fallback:

- Validate model exists and is accessible
- Validate attachments are within size limits
- Validate tool permissions for the operator

If server-side validation fails, return error response with clear guidance.

## Error Response Format

```json
{
  "error": "validation_failed",
  "message": "At least one of text, attachment, or companion prompt is required.",
  "code": "INPUT_REQUIRED",
  "details": {
    "text": false,
    "attachments": false,
    "companionPrompt": false
  }
}
```

## Success Response

```json
{
  "error": null,
  "message": null,
  "code": null,
  "details": null
}
```
