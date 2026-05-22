# Feature Specification: Knowledge Artifacts

**Feature Branch**: `012-knowledge-artifacts`

**Created**: 2026-05-21

**Status**: Stub

**Depends on**: 007 (gitea adapter)

## Summary

First-class durable documents that survive sessions: ADRs, runbooks, research notes, decision logs. Each artifact has a title, body (markdown), type, author agent, created/updated timestamps, and links to related work items. Maintained primarily by Tech Writer and Architect ephemerals on behalf of the durable staff. Surfaced in the room workspace Artifacts tab (spec 011) and mirrored to Gitea wiki via the adapter (spec 007). The artifact store is the institutional memory that makes agent work compounding rather than disposable.

## User Scenarios & Testing

[To be written — follow `.specify/templates/spec-template.md`]

## Requirements

[To be written]

## Success Criteria

[To be written]

## Assumptions

- Artifacts are stored in the ACP DB and mirrored to Gitea; DB is source of truth
- Search is full-text over title + body; semantic search is a later enhancement
- Artifacts are immutable once published; updates create new versions with a diff link
