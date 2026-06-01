# Feature Specification: Prime Onboarding Configuration

**Feature Branch**: `018-prime-onboarding-config`

**Created**: 2026-05-25

**Status**: Done

**Input**: User description: "Lets rework the onboarding workflow, analyze the openswarm codebase again for inspiration, but keep the general idea of what we have now. I want to be able to connect my cloud model and local llm providers then choose the provider and model for different functions (base modules) for the prime agent. then the default prime agent configuration should be presented to the user to make adjustments if desired. we should add a placeholder to also configure plugins that the user may want, I think it makes sense since we are using the pi harness to just let them choose from pi plugins they want to use optionally. everything is configured the prime agent is launched and a converation with the prime agent finishes configuring the users setup and it builds a team of agents based on what the user wants to accomplish"

## Clarifications

### Session 2026-05-25

- Q: Should Prime automatically create the initial team, only recommend a team, or require confirmation before creating agents? → A: Prime proposes a team plan and creates agents only after user confirmation; it should strongly recommend ACP platform maintenance agents, specifically SRE and DevOps, while leaving the rest optional.
- Q: How should provider credentials be handled during onboarding? → A: Onboarding collects provider credentials but stores them only through existing secret handling; later screens show masked values and readiness status.
- Q: Which Prime functions should be available for provider/model assignment during onboarding? → A: Onboarding must include a default set for orchestration, planning, coding/execution, review/validation, and platform maintenance, while allowing the rendered list to evolve from product configuration.
- Q: How complete should optional plugin configuration be during onboarding? → A: Users can select optional plugins during onboarding, but detailed plugin-specific configuration happens later after Prime is running.
- Q: What provider/model assignment completeness is required before Prime launch? → A: Every required Prime function must have a valid provider/model assignment before launch, but multiple functions may reuse the same provider/model.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect model providers during onboarding (Priority: P1)

A new user starts onboarding and can connect both cloud model providers and local LLM providers before the Prime Agent is launched, while retaining the familiar overall onboarding progression already present in the product.

**Why this priority**: Provider connection is the foundation for every later Prime Agent choice. Without at least one usable provider, the user cannot confidently configure or launch Prime.

**Independent Test**: Can be fully tested by starting onboarding from an unconfigured state, adding a cloud provider and a local provider, validating their availability, and confirming the user can continue without leaving onboarding.

**Acceptance Scenarios**:

1. **Given** a user has not completed onboarding, **When** they reach provider setup, **Then** they can add a cloud model provider with the required connection details and see whether it is ready to use.
2. **Given** a user has a local LLM provider available, **When** they add it during onboarding, **Then** the provider appears alongside cloud providers as a selectable source for Prime Agent functions.
3. **Given** a provider connection cannot be verified, **When** the user attempts to continue, **Then** onboarding explains the issue and offers a clear retry, edit, skip, or fallback path without exposing stored credentials.
4. **Given** the user has at least one usable provider, **When** they continue, **Then** onboarding preserves the configured provider choices for the Prime Agent configuration step and requires all required Prime functions to receive valid assignments before launch.

---

### User Story 2 - Assign providers and models to Prime functions (Priority: P2)

A user chooses which connected provider and model should be used for each Prime Agent base module or function, so high-value Prime work can use stronger models while other functions can use local or lower-cost models.

**Why this priority**: Prime must be configurable for different workloads, cost profiles, privacy needs, and local/cloud preferences before it becomes the user's operating agent.

**Independent Test**: Can be fully tested by connecting multiple providers, assigning distinct provider/model combinations to each Prime function, and confirming the resulting configuration clearly summarizes the assignments.

**Acceptance Scenarios**:

1. **Given** multiple providers and models are available, **When** the user configures Prime functions, **Then** each configurable Prime function shows a provider and model selection, including the default onboarding functions for orchestration, planning, coding/execution, review/validation, and platform maintenance.
2. **Given** a function has a recommended default, **When** the user opens the function selector, **Then** the default choice is visible and can be changed.
3. **Given** a selected model may be unsuitable for a Prime function, **When** the user chooses it, **Then** the experience warns the user or blocks continuation according to existing product safety rules.
4. **Given** the user changes a provider or model assignment, **When** they review the configuration, **Then** the summary reflects the updated assignment for the affected Prime function.

---

### User Story 3 - Review and adjust default Prime configuration (Priority: P3)

After providers and model assignments are selected, the user sees the default Prime Agent configuration and can adjust it before launch.

**Why this priority**: Users need confidence and agency before Prime starts acting on their behalf, while defaults should keep onboarding fast for users who do not need customization.

**Independent Test**: Can be fully tested by proceeding from model assignment to configuration review, making at least one adjustment, and confirming the final launch uses the adjusted configuration.

**Acceptance Scenarios**:

1. **Given** provider and model choices are complete, **When** the user reaches Prime configuration review, **Then** onboarding presents the default Prime Agent configuration in understandable sections.
2. **Given** the user wants to customize Prime, **When** they adjust an available configuration field, **Then** the change is reflected in the review before launch.
3. **Given** the user accepts the defaults, **When** they continue without edits, **Then** onboarding uses the default configuration and does not require unnecessary decisions.
4. **Given** a configuration value is invalid or incomplete, **When** the user attempts to launch Prime, **Then** onboarding identifies the affected setting and prevents an ambiguous launch state.

---

### User Story 4 - Choose optional plugins during onboarding (Priority: P4)

A user sees a placeholder step for optional plugin selection and can choose from available pi plugins where supported, while detailed plugin-specific configuration is deferred until after Prime is running and the plugin step does not block core onboarding when no plugin choice is needed.

**Why this priority**: Plugin choice is useful for extending Prime's capabilities, but it should remain optional and should not delay the core provider-to-Prime launch flow.

**Independent Test**: Can be fully tested by opening the plugin step, selecting or skipping available plugins, and confirming the resulting configuration records the user's choice without preventing Prime launch.

**Acceptance Scenarios**:

1. **Given** optional plugins are available, **When** the user reaches the plugin step, **Then** onboarding presents them as optional capabilities with clear names and descriptions.
2. **Given** the user selects one or more plugins, **When** they review the Prime configuration, **Then** the selected plugins appear in the configuration summary with any detailed plugin-specific configuration marked as a post-launch activity.
3. **Given** the user skips plugins or no plugins are available, **When** they continue, **Then** onboarding proceeds without treating plugin selection as required.
4. **Given** plugin configuration is not fully available yet, **When** the user reaches the step, **Then** the placeholder communicates what will be configurable later and preserves the rest of the flow.

---

### User Story 5 - Launch Prime and complete setup conversationally (Priority: P5)

Once configuration is complete, the system launches the Prime Agent and starts a conversation that helps finish the user's setup, proposes an initial team of agents based on what the user wants to accomplish, and creates agents only after user confirmation. Prime strongly recommends the agents needed to maintain the ACP platform itself, specifically SRE and DevOps agents, while presenting other goal-specific agents as optional.

**Why this priority**: The onboarding workflow should end with a working Prime Agent that converts setup intent into an actionable agent team, not merely a static settings screen.

**Independent Test**: Can be fully tested by completing onboarding, launching Prime, answering Prime's setup questions, confirming that SRE and DevOps agents are strongly recommended for ACP platform maintenance, and confirming agents are created only after the user approves the proposed team plan.

**Acceptance Scenarios**:

1. **Given** onboarding configuration is complete, **When** the user launches Prime, **Then** Prime starts with the selected provider/model assignments, reviewed configuration, and optional plugin choices.
2. **Given** Prime launches successfully, **When** the onboarding conversation begins, **Then** Prime asks focused questions to understand what the user wants to accomplish.
3. **Given** the user describes their goals, **When** the Prime conversation reaches a setup conclusion, **Then** Prime proposes an initial team plan aligned to those goals, strongly recommends SRE and DevOps agents for ACP platform maintenance, marks other agents as optional where appropriate, and waits for user confirmation before creating agents.
4. **Given** Prime cannot launch or cannot complete the conversation, **When** the failure occurs, **Then** the user sees a recoverable state with the ability to edit configuration, retry launch, or return to onboarding.

---

### Edge Cases

- When the user has no cloud provider credentials ready, onboarding must still allow a local-only configuration if a usable local provider is available.
- When the user has no local provider available, onboarding must still allow a cloud-only configuration if a usable cloud provider is available.
- When no providers can be verified, onboarding must explain that Prime cannot launch yet and preserve any entered configuration for later retry.
- When a user returns to edit a provider, onboarding must show masked credential state and readiness information rather than revealing previously stored secrets.
- When a provider exposes no models or model discovery fails, onboarding must offer a clear manual or fallback path without silently selecting an unknown model.
- When model choices are changed after Prime functions have been assigned, onboarding must identify affected assignments and require confirmation or correction before launch.
- When a single provider/model is suitable for multiple required Prime functions, onboarding may reuse that provider/model across those functions rather than requiring separate models.
- When optional plugin data is unavailable, onboarding must show a non-blocking placeholder rather than an empty or broken step.
- When a selected plugin requires additional details, onboarding must preserve the selection and defer detailed plugin-specific configuration until after Prime is running.
- When the user exits onboarding before launch, provider choices, function assignments, configuration edits, and plugin choices must be recoverable when they return.
- When Prime launches but team creation cannot complete, the user must retain the completed configuration and conversation context for retry or manual follow-up.

## Constitution Alignment *(mandatory)*

- **Code Quality Plan**: Define provider setup, function assignment, configuration review, plugin selection, Prime launch, and conversational team-building as independently testable onboarding slices with clear acceptance criteria and bounded terminology.
- **YAGNI Check**: New onboarding steps are required now because provider/model assignment, Prime configuration review, optional plugin selection, and launch-time team building are part of the requested user journey; plugin marketplace management, advanced policy automation, and multi-user onboarding are out of scope.
- **Reliability & Operations**: The workflow must expose clear ready, verifying, failed, skipped, saved, launching, launched, and conversation-complete states; provider verification and Prime launch failures must be recoverable and diagnosable from user-visible status and existing operational signals.
- **UX Consistency**: The primary flow must retain the general structure of the current onboarding experience while adding provider setup, Prime function assignment, configuration review, optional plugins, and Prime conversation as understandable progressive steps with explicit loading, empty, success, error, and resume states.
- **Design Consistency**: The feature should reuse existing onboarding, provider, model warning, configuration summary, and agent launch patterns where available; new patterns should be limited to the Prime function assignment matrix, plugin placeholder step, and conversational handoff where existing patterns are insufficient.
- **ACP Architecture Constraints**: Prime remains a native backend service rather than an agents-table row; onboarding must configure Prime routing and launch state through durable records while preserving single-tenant assumptions and existing isolation boundaries.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide an onboarding path for connecting cloud model providers before Prime Agent launch.
- **FR-002**: The system MUST provide an onboarding path for connecting local LLM providers before Prime Agent launch.
- **FR-003**: The system MUST show provider readiness states so users can distinguish verified, unverified, failed, skipped, and unavailable providers.
- **FR-003a**: The system MUST store provider credentials only through existing secret handling and MUST show masked credential state plus readiness status in later onboarding and review screens.
- **FR-004**: Users MUST be able to proceed with a cloud-only, local-only, or mixed provider configuration as long as every required Prime function has a valid provider/model assignment; the same provider/model MAY be reused across multiple required functions.
- **FR-005**: The system MUST present configurable Prime Agent base modules or functions that require provider/model assignments, including a default onboarding set for orchestration, planning, coding/execution, review/validation, and platform maintenance.
- **FR-006**: Users MUST be able to choose a provider and model for each configurable Prime Agent function from the providers and models available during onboarding.
- **FR-007**: The system MUST provide recommended defaults for Prime function provider/model assignments when enough provider information exists.
- **FR-008**: The system MUST warn users when a selected model may be weak, costly, unavailable, privacy-sensitive, or otherwise unsuitable for the selected Prime function according to existing product rules.
- **FR-009**: The system MUST prevent Prime launch when any required Prime function has a missing or invalid provider/model assignment, while allowing multiple required functions to share the same valid provider/model.
- **FR-010**: The system MUST present the default Prime Agent configuration after provider/model assignment and before launch.
- **FR-011**: Users MUST be able to adjust supported Prime Agent configuration values from the review step before launch.
- **FR-012**: The system MUST show a final configuration summary containing provider connections, Prime function assignments, adjusted Prime configuration values, optional plugin choices, and launch readiness.
- **FR-013**: The system MUST include an optional plugin selection step or placeholder during onboarding.
- **FR-014**: Users MUST be able to select from available pi plugins when plugin choices are available to onboarding.
- **FR-015**: Users MUST be able to skip plugin selection without blocking Prime launch.
- **FR-015a**: The system MUST defer detailed plugin-specific configuration until after Prime is running while preserving selected plugins from onboarding.
- **FR-016**: The system MUST preserve onboarding progress so users can leave and return without re-entering completed provider, assignment, configuration, or plugin choices.
- **FR-017**: The system MUST launch the Prime Agent using the finalized onboarding configuration.
- **FR-018**: The system MUST start a Prime Agent conversation after launch to finish understanding the user's goals and setup preferences.
- **FR-019**: The Prime Agent conversation MUST produce an initial team plan based on the user's stated goals, strongly recommend SRE and DevOps agents for ACP platform maintenance, identify optional goal-specific agents separately, and create agents only after user confirmation.
- **FR-020**: The system MUST provide recoverable failure paths for provider verification, model discovery, configuration validation, Prime launch, and team creation.
- **FR-021**: The onboarding workflow MUST preserve the general idea and continuity of the existing onboarding experience while reworking the steps needed for provider/model configuration and Prime launch.
- **FR-022**: Planning for this feature MUST include review of OpenSwarm-inspired onboarding and agent setup patterns as inspiration without copying branding, proprietary assets, or incompatible interaction details.

### Key Entities *(include if feature involves data)*

- **Onboarding Session**: A user's in-progress setup flow; key attributes include current step, completion state, saved choices, validation status, and resume information.
- **Model Provider**: A cloud or local source of models; key attributes include provider type, display name, masked credential state, connection status, available models, verification state, and user-facing error state.
- **Model Choice**: A selectable model from a provider; key attributes include model name, provider, availability, suitability indicators, and selection status.
- **Prime Function Assignment**: The mapping between a Prime Agent base module or function and its selected provider/model; key attributes include function name, purpose, required status, selected provider, selected model, default status, validation status, and whether it belongs to the default onboarding set for orchestration, planning, coding/execution, review/validation, or platform maintenance.
- **Prime Agent Configuration**: The launch-ready configuration for Prime; key attributes include defaults, user adjustments, function assignments, enabled optional capabilities, validation status, and launch readiness.
- **Plugin Choice**: An optional pi plugin selection; key attributes include plugin name, description, availability, selected status, configuration placeholder state, post-launch configuration requirement, and relationship to Prime capabilities.
- **Prime Launch**: The transition from onboarding configuration to a running Prime Agent; key attributes include launch status, selected configuration, failure reason when applicable, and recovery action.
- **Setup Conversation**: The post-launch conversation between the user and Prime; key attributes include user goals, Prime questions, setup decisions, team recommendation, and team creation outcome.
- **Agent Team Plan**: The recommended set of agents derived from the setup conversation; key attributes include team purpose, agent roles, initial responsibilities, relationship to the user's goals, whether each agent is strongly recommended or optional, and whether the user confirmed creation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 90% of first-time users in acceptance testing can connect at least one usable cloud or local provider and reach Prime configuration review without external documentation.
- **SC-002**: At least 85% of users can correctly identify which provider and model is assigned to each required Prime function during review, including cases where multiple functions reuse the same provider/model.
- **SC-003**: At least 90% of users can either accept defaults or make a Prime configuration adjustment and understand the resulting launch summary.
- **SC-004**: Users can skip or complete optional plugin selection in under 60 seconds without blocking the core onboarding flow.
- **SC-005**: At least 90% of completed onboarding runs produce either a successfully launched Prime Agent or a clear recoverable failure state with preserved configuration.
- **SC-006**: At least 80% of successful Prime setup conversations result in a user-confirmed team plan that strongly recommends SRE and DevOps agents for ACP platform maintenance and is rated by users as aligned with their stated goal.
- **SC-007**: Returning users can resume an incomplete onboarding session with previously completed choices restored in 95% of tested interruption scenarios.
- **SC-008**: Pilot feedback shows at least 80% agreement that the reworked onboarding flow keeps the familiar product direction while making provider, model, plugin, and Prime setup choices clearer.

## Assumptions

- The target user is a single operator or builder setting up Agent Control Plane for their own environment.
- The current onboarding workflow already has a recognizable progression that should be preserved where it does not conflict with the new provider/model and Prime configuration requirements.
- OpenSwarm-inspired means using comparable ideas for guided setup, agent/team formation, and clear capability selection, not copying branding, assets, or implementation details.
- Cloud providers and local LLM providers are both valid first-class choices for Prime, subject to existing model suitability and safety rules.
- Prime Agent functions or base modules include a default onboarding set for orchestration, planning, coding/execution, review/validation, and platform maintenance; if product configuration adds or changes functions later, onboarding should render the available configured functions without losing this default coverage.
- Optional plugin selection should be non-blocking for this feature; deeper plugin-specific configuration is deferred until after Prime is running unless already available as a safe post-launch step.
- Existing provider records, credential/secret handling, model capability warnings, Prime routing concepts, pi plugin availability, and onboarding visual patterns will be reused where possible.
- Multi-user onboarding, plugin marketplace installation, billing management, organization policy enforcement, and fully automated long-term team management are out of scope for this feature.
