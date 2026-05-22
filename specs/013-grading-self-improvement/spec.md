# Feature Specification: Grading + Self-Improvement Loop

**Feature Branch**: `013-grading-self-improvement`

**Created**: 2026-05-21

**Status**: Stub

**Depends on**: 003 (durable staff), 011 (room view / observability), 012 (knowledge artifacts)

## Summary

Durable staff (primarily Architect + SRE) evaluate completed ephemeral work against the acceptance criteria recorded at spawn time, score outcomes on defined dimensions, and update playbooks and ephemeral templates based on patterns. Closes the learning flywheel: the system gets measurably better at its own work over time without operator intervention. Grade events are first-class records in the DB. Patterns that cross a threshold trigger a proposal to update a template or playbook, which goes through the approval queue (spec 008) before taking effect.

## User Scenarios & Testing

[To be written — follow `.specify/templates/spec-template.md`]

## Requirements

[To be written]

## Success Criteria

[To be written]

## Assumptions

- Grading criteria are defined at spawn time as part of the ephemeral's task context (spec 004)
- Grade scores are stored durably in the DB alongside the work item
- Template/playbook updates proposed by the grading loop require operator approval before applying
- Relates to the checkpoint/continuation system noted in project memory
