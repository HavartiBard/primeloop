# Feature Specification: Work Item Model + Lanes + Status Machine

**Feature Branch**: `006-work-item-model`

**Created**: 2026-05-21

**Status**: Stub

**Depends on**: — (can ship in parallel with 002-005)

## Summary

Defines the DB-side model for tracked units of work: lanes (inbox, active, blocked, done, archived), a well-defined status state machine with guarded transitions, metadata schema (source, requester, assignee, priority, tags), and an event log that records every transition with actor and timestamp. Work items are the shared coordination primitive between Prime, durable staff, and ephemerals; they are also the unit mirrored to external systems-of-record (gitea, jira) in spec 007.

## User Scenarios & Testing

[To be written — follow `.specify/templates/spec-template.md`]

## Requirements

[To be written]

## Success Criteria

[To be written]

## Assumptions

- Builds on existing work item concept present in current codebase
- State machine transitions are enforced at the DB/service layer, not left to callers
- Event log is append-only
