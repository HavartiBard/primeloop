# Feature Specification: Gitea Adapter (System-of-Record)

**Feature Branch**: `007-gitea-adapter`

**Created**: 2026-05-21

**Status**: Stub

**Depends on**: 006 (work item model)

## Summary

Pushes work items, decisions, and knowledge artifacts from the ACP DB to a configured Gitea instance (issues, comments, wikis) and pulls updates back. The DB is the source of truth; Gitea is the human-readable durable mirror. Enables the operator to see the full history of what agents did, browse by project, and link agent work to code. The adapter is event-driven: work item state transitions trigger sync. Conflicts (edited in Gitea + edited in ACP) are resolved in favor of ACP with a Gitea comment noting the overwrite.

## User Scenarios & Testing

[To be written — follow `.specify/templates/spec-template.md`]

## Requirements

[To be written]

## Success Criteria

[To be written]

## Assumptions

- Operator runs their own Gitea instance; ACP stores the URL + API token in config
- One Gitea repo per ACP project (or one org-level repo for cross-cutting work items)
- Jira and other trackers are future adapters behind the same interface; Gitea is v1
