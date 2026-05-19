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
  "reasoning": "<short concise summary of what you are doing>",
  "actions": [
    {
      "type": "delegate" | "update_work_item" | "request_approval" | "no_op",
      "payload": {},
      "reason": "<why>"
    }
  ]
}

For `delegate`, payload must include:
- `title`
- `description`
- `capability`
- `allowed_files` (string[])
- `read_files` (string[])
- `verification_cmd` (optional string)
- `thread_id` (optional string)

If the right move is a direct user reply with no backend action, return `actions: []`.
