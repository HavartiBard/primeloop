// Composer validation helpers for ACP chat input

import type { ChatDraft, ModelOption, ToolConfig } from '../types/composer'

/**
 * Validate that at least one of: text, attachment, or companion prompt is present
 */
export function validateInputRequired(draft: ChatDraft): boolean {
  return (
    draft.text.trim().length > 0 ||
    draft.attachments.length > 0 ||
    draft.companionPrompt !== null
  );
}

/**
 * Validate that the selected model exists in available models
 */
export function validateModel(draft: ChatDraft, availableModels: ModelOption[]): boolean {
  if (!draft.modelId) return false;
  return availableModels.some(m => m.id === draft.modelId);
}

/**
 * Validate that the selected mode is valid
 */
export function validateMode(draft: ChatDraft): boolean {
  return draft.mode === 'planning' || draft.mode === 'agent';
}

/**
 * Validate that all attachments are within size limit
 */
export function validateAttachmentSize(draft: ChatDraft, maxSizeBytes: number): boolean {
  return draft.attachments.every(a => a.size <= maxSizeBytes);
}

/**
 * Validate that all attachments have allowed types
 */
export function validateAttachmentType(draft: ChatDraft, allowedTypes: string[]): boolean {
  return draft.attachments.every(a => allowedTypes.includes(a.mimeType));
}

/**
 * Validate that selected tools are available for the current model/mode combination
 */
export function validateToolAvailability(
  draft: ChatDraft,
  availableTools: ToolConfig
): boolean {
  return (
    (!draft.tools.webSearch || availableTools.webSearch) &&
    (!draft.tools.shell || availableTools.shell) &&
    (!draft.tools.imageProcessing || availableTools.imageProcessing)
  );
}

/**
 * Full validation suite for composer draft
 */
export function validateComposerDraft(
  draft: ChatDraft,
  options: {
    availableModels: ModelOption[];
    maxSizeBytes?: number;
    allowedTypes?: string[];
    availableTools?: ToolConfig;
  }
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!validateInputRequired(draft)) {
    errors.push('At least one of text, attachment, or companion prompt is required.');
  }

  if (options.availableModels && !validateModel(draft, options.availableModels)) {
    errors.push('Selected model is not available. Please choose a different model.');
  }

  if (!validateMode(draft)) {
    errors.push("Invalid execution mode. Please select 'planning' or 'agent'.");
  }

  if (options.maxSizeBytes && !validateAttachmentSize(draft, options.maxSizeBytes)) {
    errors.push('One or more attachments exceed the maximum size limit.');
  }

  if (options.allowedTypes && !validateAttachmentType(draft, options.allowedTypes)) {
    errors.push('One or more attachments have unsupported file types.');
  }

  if (options.availableTools && !validateToolAvailability(draft, options.availableTools)) {
    errors.push('Some selected tools may not be available for this model or mode.');
  }

  return { valid: errors.length === 0, errors };
}
