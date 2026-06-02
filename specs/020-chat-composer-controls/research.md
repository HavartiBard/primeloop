# Research: Chat Composer Controls

**Feature**: Chat Composer Controls  
**Branch**: `020-chat-composer-controls` | **Date**: 2026-06-01

## Unknowns Resolved

### 1. Placeholder text `<prime>...`

**Unknown**: What should the placeholder text be when the composer is empty and unfocused?

**Decision**: Use `<prime>...` as the placeholder text to indicate Prime-style prompt formatting.

**Rationale**: The feature spec explicitly mentions this placeholder text. It aligns with the Prime prompt format expected in the ACP chat input.

**Alternatives considered**: 
- `$ message room or @agent…` (current placeholder in `CollaborationRoomsView.tsx`) — rejected because the feature requires a Prime-style placeholder.
- `Type your Prime prompt...` — rejected as less consistent with existing Prime references.

### 2. Model selection availability

**Unknown**: How are model choices surfaced to operators?

**Decision**: Model options are supplied by existing product configuration or policy and are not defined by this feature.

**Rationale**: The spec states: "Model choices, tool categories, and mode availability are supplied by existing product configuration or policy and are not defined by this feature."

**Alternatives considered**: None needed — the feature is purely about presenting and persisting an operator's selection from an existing list.

### 3. Tool category availability

**Unknown**: Which tool categories are available to enable/disable?

**Decision**: The feature supports web search, shell access, and image processing based on the user description.

**Rationale**: The user explicitly mentioned these three tool categories. Other categories can be added later as needed.

**Alternatives considered**: None — the three categories map directly to existing backend runtime tool grants (see `backend/src/runtime.ts` and `backend/src/portal.ts`).

### 4. Companion prompt format

**Unknown**: How is the companion prompt structured when sent with the message?

**Decision**: The companion prompt is additive guidance for a single message, not a permanent persona or workspace-level setting.

**Rationale**: The spec states: "A companion prompt is additive guidance for a single message, not a permanent persona or workspace-level setting."

**Alternatives considered**: 
- Structured metadata block — rejected because no structured format is required.
- JSON payload — rejected as unnecessary complexity.

### 5. Empty draft handling

**Unknown**: What happens when an operator attempts to send a message without text but with only attachments or only a companion prompt?

**Decision**: The system MUST allow sending a message with only attachments or only a companion prompt (no main text required).

**Rationale**: This aligns with common chat patterns where images or files can be sent alone. The spec's edge case section does not specify rejection, so allowing it is the safer default.

**Alternatives considered**: 
- Require at least one text character — rejected as too restrictive and inconsistent with modern chat UX.
- Reject if no text and no attachments — rejected because companion prompts alone should be valid.

### 6. Draft preservation on validation failure

**Unknown**: How does the system preserve draft content when send validation fails?

**Decision**: The system MUST preserve the operator's current draft content and selected options when send validation fails.

**Rationale**: FR-014 explicitly requires this behavior to avoid losing work.

**Alternatives considered**: None — this is a clear functional requirement.

### 7. Mode switching behavior

**Unknown**: What happens when an operator switches modes after adding attachments or changing tool selections?

**Decision**: No restrictions — operators can freely switch between planning mode and agent mode at any time before sending.

**Rationale**: The spec does not define restrictions, and the UX should feel responsive and permissive.

**Alternatives considered**: 
- Lock selections when mode changes — rejected as unnecessary friction.
- Reset tool selections on mode change — rejected because tool availability should be independent of mode.

## Best Practices Applied

### React State Management
- Use local component state (`useState`) for draft composer controls (text, model, mode, attachments, companion prompt, tools).
- Use TanStack Query for send mutation to handle pending/success/error states.

### Upload Handling
- Support file/image uploads via standard `<input type="file" multiple>` or drag-and-drop.
- Show upload progress and errors inline in the composer.
- Limit total attachment count and size based on product policy (configurable, not hardcoded).

### Accessibility
- Ensure all controls are keyboard-navigable.
- Provide clear focus indicators for toggles, chips, and buttons.
- Announce validation errors and success states to screen readers.

## Patterns Reused

- Existing ACP chat input field in `CollaborationRoomsView.tsx`
- Attachment chip pattern (from existing artifact or draft components)
- Toggle/chip pattern for tool categories (from existing runtime/grant patterns)
- Status messaging patterns (from existing error/success displays)

## Scope Clarification

- The implementation target is the ACP chat input.
- Odysseus and OpenWeb UI are inspiration references only and are not implementation targets for this feature.
