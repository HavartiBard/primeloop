// Composer types for Primeloop chat input

export interface ChatDraft {
  text: string;
  modelId: string | null;
  mode: 'planning' | 'agent';
  attachments: Attachment[];
  companionPrompt: string | null;
  tools: ToolConfig;
  validationState: 'valid' | 'invalid' | 'pending';
  sendState: 'idle' | 'sending' | 'success' | 'error';
}

export interface Attachment {
  id: string;
  name: string;
  type: 'file' | 'image';
  mimeType: string;
  size: number;
  uploadState: 'pending' | 'uploading' | 'uploaded' | 'failed';
}

export interface ToolConfig {
  webSearch: boolean;
  shell: boolean;
  imageProcessing: boolean;
}

export interface ModelOption {
  id: string;
  name: string;
  provider: string;
  availableModes: ('planning' | 'agent')[];
}

export interface ExecutionMode {
  id: 'planning' | 'agent';
  description: string;
  defaultTools: ToolConfig;
}
