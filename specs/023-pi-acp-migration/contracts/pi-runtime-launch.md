# Contract: Pi Runtime Launch Profile

## Purpose

Define the supported launch contract for `pi` runtime-family agents after the migration.

## Contract

When the process manager starts an agent whose runtime family is `pi`, it MUST:

1. Use `AcpHarness` as the harness implementation
2. Spawn the built-in command `pi-acp`
3. Use the agent worktree as the subprocess current working directory
4. Use `workspace_root` when present, otherwise `worktree_path`, as the ACP workspace root
5. Pass through the inherited process environment plus resolved Pi model/provider environment values
6. Ignore per-agent subprocess command and argument overrides

## Failure Behavior

- If `pi-acp` is not available, startup fails with an actionable error
- If `pi` is not available beneath `pi-acp`, startup fails with an actionable error
- If ACP initialization fails, the task settles through the existing ACP failure path

## Compatibility Notes

- The registry continues to identify these agents as `pi`
- No database migration is required for existing Pi agent rows
- Generic ACP agents continue to use their own configurable command/args contract
