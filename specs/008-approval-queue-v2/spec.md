# Feature Specification: Approval Queue v2

**Feature Branch**: `008-approval-queue-v2`

**Created**: 2026-05-21

**Status**: Stub

**Depends on**: 006 (work item model)

## Summary

First-class Approval objects replacing the current MVP queue. Each approval has: a target action (with full context), requesting agent, expiry, decision (approved / denied / escalated), and an immutable audit trail. Supports batch-approve for low-risk approvals, individual review for high-impact ones, and expiry-driven auto-deny for time-sensitive gates. The UI surfaces approvals in the room workspace (spec 011) and via a dedicated queue view. Builds on the existing approval queue UI (profile editor, approval title/description) but formalises the data model and adds expiry + batch semantics.

## User Scenarios & Testing

[To be written — follow `.specify/templates/spec-template.md`]

## Requirements

[To be written]

## Success Criteria

[To be written]

## Assumptions

- Existing approval queue UI in `web/` is the starting point; data model is extended, not replaced
- Approvals that expire without a decision default to deny with a logged reason
- Agents block on pending approvals; they do not poll
