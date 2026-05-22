# Feature Specification: CoS → Ephemeral Spawn Flow

**Feature Branch**: `004-cos-ephemeral-spawn-flow`

**Created**: 2026-05-21

**Status**: Stub

**Depends on**: 002 (agent lifecycle + sandbox)

## Summary

The delegation loop: Prime decides to delegate a task, emits a spawn request, the harness provisions an ephemeral agent (applies sandbox contract, injects context, sets done criteria), monitors it to completion, and reaps it. Covers the full lifecycle from Prime decision → provisioning → task handoff → result collection → cleanup. Also covers the failure path: what Prime does if the ephemeral errors or times out.

## User Scenarios & Testing

[To be written — follow `.specify/templates/spec-template.md`]

## Requirements

[To be written]

## Success Criteria

[To be written]

## Assumptions

- Spec 002 sandbox primitive is implemented
- Prime can emit a structured `spawn` action (extends current action schema in `actions.ts`)
- Result is returned to Prime as a work item update, not a raw message
