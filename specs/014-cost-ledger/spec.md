# Feature Specification: Cost Ledger

**Feature Branch**: `014-cost-ledger`

**Created**: 2026-05-21

**Status**: Stub

**Depends on**: 002 (agent lifecycle + sandbox)

## Summary

Tracks token consumption and tool-call costs per agent per task session. Every LLM call and billable tool invocation is recorded with: agent_id, task_id, model, input tokens, output tokens, cost estimate, timestamp. Aggregates are surfaced in the room workspace status panel (spec 011) and queryable via API. Enables the operator to see where spend is going, identify expensive patterns, and set soft budget limits that trigger an approval gate before an agent incurs further cost. Inspired by OpenSwarm's per-session cost tracking.

## User Scenarios & Testing

[To be written — follow `.specify/templates/spec-template.md`]

## Requirements

[To be written]

## Success Criteria

[To be written]

## Assumptions

- Cost estimates are based on published model pricing; actual billing is through Anthropic/provider
- Budget limits are advisory in v1 (trigger approval, don't hard-stop)
- Cost data is append-only; no retroactive correction
