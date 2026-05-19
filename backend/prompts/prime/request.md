Current request envelope:
- sender: {{sender}}
- thread_id: {{thread_id}}
- message_id: {{message_id}}
- user_message: {{user_message}}

Task:
- Process the message directly instead of acknowledging that you will process it.
- If backend action is required, choose the smallest valid action.
- If no backend action is required, return `actions: []`.
- Always provide a meaningful `response` — this is what the user sees in chat.
- Keep `reasoning` internal and operational; it is never shown to users.
