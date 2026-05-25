# Feature Specification: Durable Staff Bootstrap

**Feature Branch**: `003-durable-staff-bootstrap`

**Created**: 2026-05-21

**Status**: Stub

**Depends on**: 002 (agent lifecycle + sandbox)

## Summary

Provisions the three durable staff agents — Architect, SRE, DevOps — on first run and ensures they survive restarts. Each gets a persona file, a defined tool set, a persistent worktree, and a registered agent record. Bootstrap is idempotent: re-running it against an already-provisioned instance updates config without duplicating agents. Covers both the initial provisioning flow and the steady-state "durable agent comes back up after harness restart" path.

## User Scenarios & Testing

[To be written — follow `.specify/templates/spec-template.md`]

## Requirements

[To be written]

## Success Criteria

[To be written]

## Assumptions

- Spec 002 agent lifecycle and sandbox primitive is implemented
- Persona files for Architect, SRE, DevOps exist as `.md` files in `.agent-workspace/agents/`
- Tool sets for each role are defined (specific MCPs TBD in spec 009)
