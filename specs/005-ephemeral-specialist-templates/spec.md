# Feature Specification: Ephemeral Specialist Templates

**Feature Branch**: `005-ephemeral-specialist-templates`

**Created**: 2026-05-21

**Status**: Stub

**Depends on**: 003 (durable staff bootstrap), 004 (spawn flow)

## Summary

Defines the v1 ephemeral specialist templates: Researcher, Tech Writer, QA, Security. Each template is a versioned definition comprising a persona (`.md`), a tool-set (MCP scopes granted), an output format contract, done criteria, and a resource-limit profile. Prime instantiates a template by name; the harness resolves the template to a full sandbox spec at spawn time. Prime can also compose ad-hoc ephemerals for tasks that don't match a named template.

## User Scenarios & Testing

[To be written — follow `.specify/templates/spec-template.md`]

## Requirements

[To be written]

## Success Criteria

[To be written]

## Assumptions

- Templates are stored as versioned files alongside persona files in `.agent-workspace/`
- Spec 009 (MCP registry) defines the tool-scope mechanism templates rely on
