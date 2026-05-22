# Feature Specification: Room / Collaboration View (Circuit View)

**Feature Branch**: `011-circuit-view`

**Created**: 2026-05-21

**Status**: Stub

**Depends on**: 002-005 (agents running and producing state)

## Summary

The situational-awareness layer: a room-centric workspace where each collaboration room maps to an active agent or workstream. Left drawer shows rooms sorted by activity with status indicators (active / attention / blocked / archived). Right workspace shows the selected room with Chat, Status, Signals, and Artifacts tabs. Promoted actions (approve, branch, ask Prime) route through Prime — the view does not replace direct orchestration.

> **Note**: The original spatial canvas concept was previously abandoned in favor of this room-centric model. The `LiveCircuitMap.tsx` component already implements the room-centric layout; this spec formalises its data model, formalises the promoted-action contract, and extends it with real agent-derived state (replacing fallback sample data).

## User Scenarios & Testing

[To be written — follow `.specify/templates/spec-template.md`]

## Requirements

[To be written]

## Success Criteria

[To be written]

## Assumptions

- `web/src/components/LiveCircuitMap.tsx` is the starting implementation
- Room state is derived from agent state + work items in the DB (not from agent memory)
- All promoted actions translate to Prime instructions, not direct agent API calls
- WebSocket streaming provides real-time updates (existing pattern in codebase)
