# Contract: Process Manager Routing for Pi Agents

## Purpose

Document how runtime-family selection maps Pi agents onto the ACP harness path.

## Routing Rules

1. If an agent has runtime family `pi`, the process manager MUST select the Pi ACP launch profile.
2. The Pi ACP launch profile MUST instantiate `AcpHarness`, not `PiHarness`.
3. The Pi ACP launch profile MUST be centrally defined in process-manager runtime selection logic.
4. Existing `acp` runtime-family agents continue to use their configured ACP command/args contract.
5. Non-ACP managed local runtimes remain unaffected by this migration.

## Override Handling

- For `pi` runtime-family agents, subprocess command/argument overrides in agent config are ignored.
- For generic `acp` runtime-family agents, subprocess command/argument overrides remain supported.

## Invariants

- Pi remains a distinct runtime family for operator understanding and backward compatibility.
- Pi startup behavior is deterministic across all Pi agents.
- Removing the Pi-specific harness does not change downstream task, delegation, or approval flows.
