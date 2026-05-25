# Quickstart: Verifying Prime Empty Fleet Fix

## Prerequisites

- Backend service running with PostgreSQL
- Prime agent enabled in `prime_agent_config`
- A configured LLM provider (Anthropic/OpenAI) in the `providers` table

## Verification Steps

### 1. Confirm fleet is empty

```sql
SELECT COUNT(*) FROM agents WHERE enabled = true;
-- Should return 0
```

### 2. Send a task to Prime via the events endpoint

```bash
curl -X POST http://localhost:3000/api/prime/events \
  -H "Content-Type: application/json" \
  -d '{
    "type": "prime.message",
    "payload": {
      "thread_id": "test-thread-1",
      "message_id": "msg-1",
      "content": "Please implement a new login page for the dashboard",
      "sender": "human"
    }
  }'
```

### 3. Verify the response

Expected behavior:
- HTTP 202 (event queued successfully)
- Prime processes the event and returns a decision with:
  - A meaningful `response` field explaining it will handle the task directly or track it
  - No `delegate` action in the `actions` array
  - Either an empty `actions` array or a `no_op` action with reason noting the empty fleet

### 4. Verify a pending work item was created

```sql
SELECT id, title, status, metadata
FROM work_items
WHERE metadata->>'action_type' = 'pending_delegation'
ORDER BY created_at DESC
LIMIT 1;
```

Expected: A row with `status = 'pending'` and metadata containing the capability and reason.

### 5. Verify system prompt includes empty-fleet message

Check the logs or add debug output to confirm the `## Fleet Agents` section contains:
```
(no agents available — respond directly to the user)
```
