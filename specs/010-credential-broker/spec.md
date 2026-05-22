# Feature Specification: Credential Broker

**Feature Branch**: `010-credential-broker`

**Created**: 2026-05-21

**Status**: Stub

**Depends on**: 002 (agent lifecycle + sandbox)

## Summary

Issues short-lived, per-agent, scoped credentials at spawn time and revokes them on teardown. Prevents credential sprawl in the shared harness environment: no agent holds a long-lived secret directly; all secrets are brokered tokens valid for the agent's lifespan. The broker also handles credential rotation for durable agents without restarting them. Supports at minimum: API keys (LLM providers), Gitea tokens, and operator-defined named secrets. Secret values are never written to the worktree or workdir; they are injected as environment variables at process start.

## User Scenarios & Testing

[To be written — follow `.specify/templates/spec-template.md`]

## Requirements

[To be written]

## Success Criteria

[To be written]

## Assumptions

- Master secrets are stored encrypted in the ACP DB (using existing `SECRET_ENCRYPTION_KEY` pattern)
- Per-agent tokens are derived/scoped, not copies of master secrets where the upstream supports scoping
- Revocation is synchronous with agent teardown (no grace period for ephemerals)
