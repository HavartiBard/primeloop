# Feature Specification: Chat Composer Controls

**Feature Branch**: `[020-chat-composer-controls]`

**Created**: 2026-06-01

**Status**: Draft

**Input**: User description: "Analyze the odysseus and openweb ui chat input fields, I want to be able to select the model the agent invokes when i sent the message. the chat box should have the text message <prime>... in the text box until i type something it. I should be able to upload an image, file or craft a prompt to go along with the message and be able to emable/disable tools such as web search, shell or image processing. I should also be ale to toggle planning vs agent mode"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Send a guided agent request (Priority: P1)

As an operator using the ACP chat input, I want the chat composer to show the expected Prime-style prompt format, let me choose the model and execution mode, and send one well-scoped request so I can control how the agent responds before I submit the message.

**Why this priority**: The core value is giving operators immediate control over how a message is interpreted and which agent behavior is invoked at send time.

**Independent Test**: Can be fully tested by opening a chat room, observing the default placeholder, choosing a model, switching between planning and agent mode, sending a message, and confirming the sent request reflects the chosen settings.

**Acceptance Scenarios**:

1. **Given** an operator opens a supported chat composer with an empty draft, **When** the input first renders, **Then** it displays the placeholder text `<prime>...` until the operator begins typing.
2. **Given** an operator has entered a message, **When** they choose a model and send the message, **Then** the submitted request records and uses the selected model for that message.
3. **Given** an operator is composing a message, **When** they toggle between planning mode and agent mode before sending, **Then** the submitted request reflects the selected mode and the UI clearly shows which mode is active.

---

### User Story 2 - Attach supporting inputs to a message (Priority: P2)

As an operator, I want to attach files, images, and an optional companion prompt to a chat message so the agent receives the supporting context it needs in a single send action.

**Why this priority**: Rich inputs reduce follow-up turns and make the agent more effective for analysis, planning, and execution tasks.

**Independent Test**: Can be fully tested by composing a message with an uploaded file, an uploaded image, and an added companion prompt, then sending and confirming all selected inputs are associated with that message.

**Acceptance Scenarios**:

1. **Given** an operator is composing a message, **When** they add one or more supported attachments, **Then** the composer shows the selected attachments before send and includes them with the message.
2. **Given** an operator wants to add extra instructions beyond the main message body, **When** they add a companion prompt, **Then** the prompt is visibly associated with the draft and sent alongside the message.
3. **Given** an operator removes an attachment or companion prompt before sending, **When** the draft is submitted, **Then** only the remaining selected inputs are included.

---

### User Story 3 - Control tool access per message (Priority: P3)

As an operator, I want to enable or disable tool categories such as web search, shell access, and image processing before sending a message so I can control the scope, safety, and cost of each agent run.

**Why this priority**: Per-message tool controls help operators tailor execution to the task and avoid unnecessary or undesired capabilities.

**Independent Test**: Can be fully tested by toggling tool categories on and off for a draft, sending the message, and confirming the resulting request includes only the enabled tools.

**Acceptance Scenarios**:

1. **Given** an operator is composing a message, **When** they disable a tool category and send the draft, **Then** the sent request excludes that tool category from the allowed capabilities.
2. **Given** an operator enables multiple tool categories, **When** the draft is sent, **Then** the sent request includes all selected tool categories.
3. **Given** an operator starts a new draft after sending a prior message, **When** the composer loads, **Then** it applies the product's default tool selections rather than silently inheriting unintended settings from the previous message.

### Edge Cases

- **Empty draft with only attachments**: Allowed. A message can be sent with only file/image attachments and no text body.
- **Empty draft with only companion prompt**: Allowed. A message can be sent with only a companion prompt and no text body.
- **Model becomes unavailable after selection**: The system preserves the draft content and selections when send validation fails. The operator must select a different available model.
- **Attachment upload fails**: The attachment remains in pending state with error indication. The operator can retry or remove the attachment before sending.
- **Attachment too large**: Rejected at upload time with clear error message showing configured maximum size.
- **Unsupported file type**: Rejected at upload time with clear error listing allowed file types per product policy.
- **Tool category unavailable for selected model/mode**: A warning is displayed to the operator. The send is blocked until the operator disables the unavailable tool or selects a different model/mode combination.

## Constitution Alignment *(mandatory)*

- **Code Quality Plan**: Keep message composition rules, validation, and send-state behavior consistent across the ACP chat input; verify the primary flows and edge cases before release.
- **YAGNI Check**: None. This feature adds only the operator controls needed to shape a single chat request at send time.
- **Reliability & Operations**: The composer must clearly surface failed uploads, unavailable selections, and rejected sends so operators can correct the draft without losing their work.
- **UX Consistency**: The ACP chat input must present consistent controls, terminology, and draft states for empty, editing, uploading, ready-to-send, sending, success, and error conditions.
- **Design Consistency**: The composer should reuse existing chat input patterns, chip/toggle patterns, attachment affordances, and status messaging already familiar to operators.
- **ACP Architecture Constraints**: No architectural change. This feature changes how operators configure a message before sending it to the existing agent workflow.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide the enhanced chat composer in the ACP chat input where operators submit agent chat messages.
- **FR-002**: The system MUST display the placeholder text `<prime>...` whenever the main message field is empty and unfocused by user-entered text.
- **FR-003**: Users MUST be able to enter a free-form message as the primary content of the draft.
- **FR-004**: Users MUST be able to select the model that will be invoked for the message before sending.
- **FR-005**: The system MUST show the currently selected model in the composer before the message is sent.
- **FR-006**: Users MUST be able to choose between planning mode and agent mode before sending a message.
- **FR-007**: The system MUST include the selected execution mode with the submitted message request.
- **FR-008**: Users MUST be able to upload and remove one or more supported files before sending a message.
- **FR-009**: Users MUST be able to upload and remove one or more supported images before sending a message.
- **FR-010**: Users MUST be able to add, edit, and remove an optional companion prompt that is sent alongside the main message.
- **FR-011**: The system MUST show all draft inputs selected for the message, including attachments, companion prompt presence, selected model, selected mode, and enabled tool categories, before send.
- **FR-012**: Users MUST be able to enable or disable supported tool categories for an individual message, including web search, shell access, and image processing.
- **FR-013**: The system MUST prevent unavailable or invalid combinations from being sent and MUST explain what the operator needs to change.
- **FR-014**: The system MUST preserve the operator's current draft content and selected options when send validation fails.
- **FR-015**: The system MUST send all chosen message inputs as one request so the receiving agent run has access to the operator's full intended context.
- **FR-016**: The system MUST provide clear sending, success, and error feedback for the composer.
- **FR-017**: The system MUST reset the draft after a successful send while restoring the default placeholder and default control state for the next message.
- **FR-018**: The system MUST allow the product to define default selections for model, mode, and tool categories for the ACP chat input.

### Key Entities *(include if feature involves data)*

- **Chat Draft**: The in-progress message being composed, including main text, selected model, selected execution mode, attachments, companion prompt, enabled tools, validation state, and send state.
- **Model Option**: A selectable agent model choice presented to the operator for a single message.
- **Execution Mode**: The operator-selected run style for a message, limited to planning mode or agent mode.
- **Attachment**: A user-supplied file or image associated with a draft and intended to be sent with the message.
- **Companion Prompt**: Optional extra instructions attached to the main message to guide the receiving agent.
- **Tool Category**: A selectable capability group that the operator may allow or deny for an individual message.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In usability testing of the ACP chat input, 90% of operators can identify and change the model and execution mode for a draft without assistance.
- **SC-002**: 95% of valid message submissions that include any supported combination of text, attachments, companion prompt, and tool selections complete without requiring the operator to re-enter draft content.
- **SC-003**: 100% of blocked submissions present a clear corrective message that identifies the invalid or unavailable selection.
- **SC-004**: 90% of operators in validation testing can successfully send a message with at least one attachment or companion prompt on their first attempt.
- **SC-005**: Operators can complete the primary “configure and send” flow in under 30 seconds for a text-only message and under 60 seconds for a message with attachments in moderated testing.

## Clarifications

### Session 2026-06-01

- Q: What is the maximum number of attachments allowed per message? → A: No explicit limit defined; product policy configures this externally.
- Q: Is this feature for Odysseus/OpenWeb UI or ACP? → A: ACP chat input only; Odysseus and OpenWeb UI are inspirations, not target surfaces.

## Assumptions

- This feature targets the ACP chat input only. Odysseus and OpenWeb UI are inspiration references, not implementation targets.
- Model choices, tool categories, and mode availability are supplied by existing product configuration or policy and are not defined by this feature.
- A companion prompt is additive guidance for a single message, not a permanent persona or workspace-level setting.
- Existing message delivery, authorization, and agent invocation workflows remain in place; this feature only extends what the operator can configure before send.
- Unsupported file types, oversize uploads, or unavailable capabilities will be rejected with user-visible guidance rather than silently ignored.
- Attachment count limits are governed by product policy configuration, not hardcoded in this feature.
