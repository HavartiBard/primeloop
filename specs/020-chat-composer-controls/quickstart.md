# Quick Start: Chat Composer Controls

**Feature**: Chat Composer Controls  
**Branch**: `020-chat-composer-controls` | **Date**: 2026-06-01

## Overview

This feature enhances the ACP chat input to let operators configure agent execution at send time. Operators can:

1. Select the model that will be invoked
2. Toggle between planning mode and agent mode
3. Attach files and images
4. Add an optional companion prompt
5. Enable/disable tool categories (web search, shell access, image processing)

## User Flow

### 1. Open a Chat Composer

- Navigate to the ACP chat input surface
- The composer appears in the ACP chat panel
- Empty composer shows placeholder: `<prime>...`

### 2. Configure Message Settings

- **Model**: Select from available models (populated from product configuration)
- **Mode**: Toggle between "planning" and "agent" modes
- **Tools**: Enable/disable tool categories using toggles/chips

### 3. Add Message Content

- **Text**: Type your message in the main input field
- **Attachments**: Click attachment button to select files or images
- **Companion Prompt**: Add optional extra instructions if needed

### 4. Send Message

- Click "Send" button (or press Enter)
- Composer validates configuration
- If valid, sends message with selected settings
- If invalid, shows clear error message and preserves draft

### 5. After Send

- Composer resets to empty state
- Placeholder returns to `<prime>...`
- Draft content and selections are cleared

## Common Tasks

### Send a Text Message with Default Settings

1. Type your message in the composer
2. Click "Send"

### Send a Message with Attachments

1. Click attachment button
2. Select one or more files/images
3. Optionally add companion prompt
4. Click "Send"

### Send a Message with Custom Tools

1. Toggle tool categories on/off as needed
2. Add your message text (or attachments only)
3. Click "Send"

### Switch Between Planning and Agent Mode

1. Click mode toggle before sending
2. Observe active mode indicator
3. Compose and send message

## Validation Rules

- At least one of: text, attachment, or companion prompt must be present
- Selected model must be available in product configuration
- Attachment size must not exceed configured maximum
- Attachment type must be allowed by product policy

## Error States

| Error | Cause | Resolution |
|-------|-------|------------|
| "At least one of text, attachment, or companion prompt is required" | Empty draft with no inputs | Add text, attach file/image, or add companion prompt |
| "Model not available" | Selected model removed or disabled | Choose a different model from the list |
| "Attachment too large" | File exceeds size limit | Compress or select a smaller file |
| "Unsupported file type" | File type not allowed | Convert to an allowed format |

## Performance Expectations

- Composer toggle interactions: <100ms perceived latency
- File upload: proportional to file size and network speed
- Send action: <500ms for validation, then backend processing time
