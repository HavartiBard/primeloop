# Quickstart: Agentic Control Plane

## Purpose
This document explains how to validate the planned operator experience for the
Agentic Control Plane feature once implementation begins.

## Preconditions
- The backend and web applications are running in the local development environment.
- Prime is available as the operator-facing entry point.
- Durable storage is available for goals, work items, approvals, recovery events,
  and learning records.

## Scenario 1: Submit and monitor a goal through Prime
1. Open the control plane workspace.
2. Create a new goal for Prime that includes a clear intended outcome.
3. Confirm the goal appears in the workspace with an initial queued or in-progress
   state.
4. Confirm the workspace shows Prime-owned progress, recent decisions, and current
   summary without requiring navigation into specialist-only views.

## Scenario 2: Verify specialist delegation across domains
1. Submit a goal that requires at least two of the following domains: homelab,
   development, personal assistant.
2. Confirm Prime creates separate work items for the relevant specialist roles.
3. Confirm delegated work appears under the parent goal with clear assignee,
   status, and purpose.
4. Confirm Prime remains the only steering interface shown to the operator.

## Scenario 3: Verify approval handling
1. Trigger a workflow that proposes a high-impact or irreversible action.
2. Confirm the goal pauses in an approval-related state.
3. Confirm the approval record shows the requested action, risk summary, and
   available operator decision.
4. Approve or reject the action and confirm the goal and work-item states update
   accordingly.

## Scenario 4: Verify recovery and self-healing behavior
1. Simulate a delegated work item entering a blocked or failed state.
2. Confirm a recovery event is recorded with the detected condition and selected
   recovery or escalation action.
3. Confirm the operator sees the updated status and can understand what changed.
4. If recovery fails, confirm the goal escalates or pauses rather than silently
   stalling.

## Scenario 5: Verify post-run learning capture
1. Complete a goal successfully or with a terminal failure.
2. Confirm the final summary describes outcome, contributing agents, unresolved
   risks, and next steps if any.
3. Confirm a learning record is created describing the notable outcome and the
   recommended future improvement.

## Expected Outcomes
- Operators can create and understand a goal quickly.
- Prime remains the single user-facing control path.
- Delegated work is visible but not directly user-steered.
- Blocked work is observable and produces recovery records.
- Completed work produces clear summaries and reusable learning artifacts.
