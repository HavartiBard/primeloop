import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { HarnessEvent, TaskResult } from '../fleet-executor/harness.js';

export function updateMapper(update: SessionUpdate): HarnessEvent | null {
  // The ACP SDK discriminant is `sessionUpdate`, not `type`.
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      // update is ContentChunk: { content: ContentBlock, sessionUpdate }
      // ContentBlock is a union discriminated by `type`; extract text from text blocks only.
      const block = update.content
      const text = block.type === 'text' ? block.text : ''
      if (!text) return null;
      return { type: 'message_update', delta: text };
    }

    case 'tool_call': {
      // update is ToolCall: { title, toolCallId, rawInput?, ... }
      return {
        type: 'tool_call_start',
        tool: update.title,
        args: (update.rawInput as Record<string, unknown>) ?? {},
      };
    }

    case 'tool_call_update': {
      // update is ToolCallUpdate: { toolCallId, title?, status?, content[]?, ... }
      // Completed/failed tool calls carry their result in content[]; map to tool_call_end.
      if (update.status === 'completed' || update.status === 'failed') {
        const textContent = update.content?.find(
          (c): c is Extract<typeof c, { type: 'content' }> => c.type === 'content'
        )
        const resultText =
          textContent?.content.type === 'text' ? textContent.content.text : undefined
        return {
          type: 'tool_call_end',
          tool: update.title ?? update.toolCallId,
          result: resultText,
          error: update.status === 'failed' ? (resultText ?? 'tool call failed') : undefined,
        };
      }
      // In-progress update — surface as progress so the canvas shows activity.
      return {
        type: 'progress',
        summary: `Tool ${update.title ?? update.toolCallId} in progress`,
      };
    }

    case 'plan':
    case 'plan_update': {
      return {
        type: 'progress',
        summary: 'Plan updated',
      };
    }

    case 'plan_removed':
    case 'user_message_chunk':
    case 'agent_thought_chunk':
    case 'available_commands_update':
      // Ignored in v1 per contract
      return null;

    default:
      // Unknown update type — ignore for forward compatibility
      return null;
  }
}

export function mapTaskEnd(stopReason: string, finalText: string, tokens: number): TaskResult {
  return {
    text: finalText,
    tokens,
    error: stopReason === 'cancelled' ? 'Task was cancelled' : undefined,
  };
}
