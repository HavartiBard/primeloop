import { describe, it, expect } from 'vitest';
import { updateMapper, mapTaskEnd } from '../../src/acp/update-mapper.js';

describe('updateMapper', () => {
  it('maps agent_message_chunk (text) to message_update', () => {
    const event = updateMapper({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Hello' },
    } as any);
    expect(event).toEqual({ type: 'message_update', delta: 'Hello' });
  });

  it('returns null for agent_message_chunk with non-text content', () => {
    const event = updateMapper({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'image', data: 'base64' },
    } as any);
    expect(event).toBeNull();
  });

  it('maps tool_call to tool_call_start', () => {
    const event = updateMapper({
      sessionUpdate: 'tool_call',
      title: 'read_file',
      toolCallId: 'tc1',
      rawInput: { path: '/test' },
    } as any);
    expect(event).toEqual({ type: 'tool_call_start', tool: 'read_file', args: { path: '/test' } });
  });

  it('maps in-progress tool_call_update to progress', () => {
    const event = updateMapper({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc1',
      title: 'read_file',
      status: 'in_progress',
    } as any);
    expect(event).toEqual({ type: 'progress', summary: 'Tool read_file in progress' });
  });

  it('maps completed tool_call_update to tool_call_end', () => {
    const event = updateMapper({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc1',
      title: 'read_file',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'file data' } }],
    } as any);
    expect(event).toEqual({ type: 'tool_call_end', tool: 'read_file', result: 'file data', error: undefined });
  });

  it('maps failed tool_call_update to tool_call_end with error', () => {
    const event = updateMapper({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc1',
      title: 'read_file',
      status: 'failed',
      content: [{ type: 'content', content: { type: 'text', text: 'not found' } }],
    } as any);
    expect(event).toEqual({ type: 'tool_call_end', tool: 'read_file', result: 'not found', error: 'not found' });
  });

  it('maps plan to progress', () => {
    const event = updateMapper({ sessionUpdate: 'plan' } as any);
    expect(event).toEqual({ type: 'progress', summary: 'Plan updated' });
  });

  it('maps plan_update to progress', () => {
    const event = updateMapper({ sessionUpdate: 'plan_update' } as any);
    expect(event).toEqual({ type: 'progress', summary: 'Plan updated' });
  });

  it('ignores available_commands_update', () => {
    const event = updateMapper({ sessionUpdate: 'available_commands_update' } as any);
    expect(event).toBeNull();
  });

  it('ignores user_message_chunk', () => {
    const event = updateMapper({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'hi' } } as any);
    expect(event).toBeNull();
  });

  it('ignores unknown update types', () => {
    const event = updateMapper({ sessionUpdate: 'unknown_future_type' } as any);
    expect(event).toBeNull();
  });
});

describe('mapTaskEnd', () => {
  it('maps successful end', () => {
    const result = mapTaskEnd('end_turn', 'Done', 100);
    expect(result).toEqual({ text: 'Done', tokens: 100, error: undefined });
  });

  it('maps cancelled end', () => {
    const result = mapTaskEnd('cancelled', 'Partial', 50);
    expect(result).toEqual({ text: 'Partial', tokens: 50, error: 'Task was cancelled' });
  });
});
