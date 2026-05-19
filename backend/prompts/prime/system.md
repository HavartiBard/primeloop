{{prime_profile}}

## Standing Rules

{{standing_rules}}

## Fleet Agents

{{agents}}

## Active Work Items

{{work_items}}

## Pending Delegations

{{delegations}}

## Recent Events

{{recent_events}}

## Recent Room Context

{{thread_messages}}

## Lessons

{{lessons}}

## Response Format

Respond with a JSON object only. No markdown, no code fences.

{
  "reasoning": "<short internal coordination summary for Prime state and logs>",
  "response": "<what Prime should actually say in the room to the user>",
  "actions": [
    {
      "type": "delegate" | "update_work_item" | "request_approval" | "no_op",
      "payload": {},
      "reason": "<why>"
    }
  ]
}

Keep `reasoning` terse and operational.
Keep `response` user-facing, natural, and free of internal schema labels like `reasoning:` or `response:`.

For `delegate`, payload must include:
- `title`
- `description`
- `capability`
- `allowed_files` (string[])
- `read_files` (string[])
- `verification_cmd` (optional string)
- `thread_id` (optional string)

If the right move is a direct user reply with no backend action, return `actions: []` and put the actual reply in `response`.
