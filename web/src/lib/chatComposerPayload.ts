// Composer payload mapping helpers for ACP message submission

import type { ChatDraft } from '../types/composer';

export interface SendRequest {
  text: string;
  modelId: string;
  mode: 'planning' | 'agent';
  attachments: AttachmentMetadata[];
  companionPrompt: string | null;
  tools: ToolConfig;
}

export interface AttachmentMetadata {
  id: string;
  name: string;
  type: 'file' | 'image';
  mimeType: string;
  size: number;
}

/**
 * Map composer draft to ACP message submission payload
 */
export function mapDraftToSendRequest(draft: ChatDraft): SendRequest {
  return {
    text: draft.text,
    modelId: draft.modelId || '',
    mode: draft.mode,
    attachments: draft.attachments.map(a => ({
      id: a.id,
      name: a.name,
      type: a.type,
      mimeType: a.mimeType,
      size: a.size,
    })),
    companionPrompt: draft.companionPrompt,
    tools: {
      webSearch: draft.tools.webSearch,
      shell: draft.tools.shell,
      imageProcessing: draft.tools.imageProcessing,
    },
  };
}

/**
 * Create an empty composer draft with default values
 */
export function createEmptyDraft(): ChatDraft {
  return {
    text: '',
    modelId: null,
    mode: 'agent',
    attachments: [],
    companionPrompt: null,
    tools: {
      webSearch: false,
      shell: true,
      imageProcessing: false,
    },
    validationState: 'valid',
    sendState: 'idle',
  };
}

/**
 * Reset draft to initial state after successful send
 */
export function resetDraft(draft: ChatDraft): ChatDraft {
  return {
    ...createEmptyDraft(),
    text: '',
    modelId: draft.modelId, // Preserve last selected model
  };
}
