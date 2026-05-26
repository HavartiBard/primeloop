// ─────────────────────────────────────────────────────────────────────────────
// Toolbar Actions Hook (spec 017)
// Manage toolbar action state and submission
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useCallback } from 'react'
import type { ToolbarActionType, ToolbarDraftAction } from '../types'
import {
  createGoal,
  createArtifact,
  addNote,
} from '../api'

/**
 * Toolbar action result from API
 */
interface ToolbarActionResult {
  createdRef?: {
    type: string
    id: string
  }
}

/**
 * Options for the toolbar actions hook
 */
export interface UseToolbarActionsOptions {
  /** Callback when action is submitted successfully */
  onActionSuccess?: (draftId: string, result: ToolbarActionResult) => void
  /** Callback when action fails */
  onActionError?: (draftId: string, error: Error) => void
}

/**
 * Result from the toolbar actions hook
 */
export interface UseToolbarActionsResult {
  /** Current drafts by ID */
  drafts: Record<string, ToolbarDraftAction>
  /** Open a new draft */
  openDraft: (actionType: ToolbarActionType, originContext?: {
    activeRoomId?: string
    selectedWorkItemId?: string
    selectedNodeId?: string
  }) => string
  /** Update a draft */
  updateDraft: (draftId: string, updates: Partial<ToolbarDraftAction>) => void
  /** Submit a draft */
  submitDraft: (draftId: string) => Promise<void>
  /** Cancel a draft */
  cancelDraft: (draftId: string) => void
  /** Get current active draft */
  getActiveDraft: () => ToolbarDraftAction | undefined
  /** Clear all drafts */
  clearAllDrafts: () => void
}

/**
 * Hook to manage toolbar action state and submission
 */
export function useToolbarActions(
  options: UseToolbarActionsOptions = {},
): UseToolbarActionsResult {
  const { onActionSuccess, onActionError } = options

  const [drafts, setDrafts] = useState<Record<string, ToolbarDraftAction>>({})

  // Generate unique draft ID
  const generateDraftId = useCallback(() => {
    return `draft-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
  }, [])

  // Open a new draft
  const openDraft = useCallback(
    (actionType: ToolbarActionType, originContext?: {
      activeRoomId?: string
      selectedWorkItemId?: string
      selectedNodeId?: string
    }): string => {
      const draftId = generateDraftId()

      setDrafts((prev) => ({
        ...prev,
        [draftId]: {
          id: draftId,
          actionType,
          originContext: originContext || {},
          requiredInputs: {},
          status: 'draft',
        },
      }))

      return draftId
    },
    [generateDraftId],
  )

  // Update a draft
  const updateDraft = useCallback(
    (draftId: string, updates: Partial<ToolbarDraftAction>) => {
      setDrafts((prev) => {
        const existing = prev[draftId]
        if (!existing) return prev

        return {
          ...prev,
          [draftId]: {
            ...existing,
            ...updates,
            requiredInputs: {
              ...(existing.requiredInputs || {}),
              ...(updates.requiredInputs || {}),
            },
          },
        }
      })
    },
    [],
  )

  // Submit a draft
  const submitDraft = useCallback(
    async (draftId: string): Promise<void> => {
      const draft = drafts[draftId]
      if (!draft) return

      setDrafts((prev) => ({
        ...prev,
        [draftId]: {
          ...prev[draftId],
          status: 'submitting',
        },
      }))

      try {
        // Submit to actual API endpoints
        const result = await submitToolbarAction(
          draft,
          draft.originContext?.activeRoomId,
        )

        setDrafts((prev) => ({
          ...prev,
          [draftId]: {
            ...prev[draftId],
            status: 'succeeded',
            createdRef: result?.createdRef,
          },
        }))

        if (onActionSuccess) {
          onActionSuccess(draftId, result)
        }
      } catch (error) {
        setDrafts((prev) => ({
          ...prev,
          [draftId]: {
            ...prev[draftId],
            status: 'failed',
            errorSummary: error instanceof Error ? error.message : 'Unknown error',
          },
        }))

        if (onActionError) {
          onActionError(draftId, error as Error)
        }
      }
    },
    [drafts, onActionSuccess, onActionError],
  )

  // Cancel a draft
  const cancelDraft = useCallback(
    (draftId: string) => {
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[draftId]
        return next
      })
    },
    [],
  )

  // Get current active draft
  const getActiveDraft = useCallback((): ToolbarDraftAction | undefined => {
    const ids = Object.keys(drafts)
    if (ids.length === 0) return undefined
    return drafts[ids[ids.length - 1]]
  }, [drafts])

  // Clear all drafts
  const clearAllDrafts = useCallback(() => {
    setDrafts({})
  }, [])

  return {
    drafts,
    openDraft,
    updateDraft,
    submitDraft,
    cancelDraft,
    getActiveDraft,
    clearAllDrafts,
  }
}

/**
 * Submit toolbar action to actual API endpoints
 */
async function submitToolbarAction(
  draft: ToolbarDraftAction,
  threadId?: string,
): Promise<{
  createdRef?: { type: string; id: string }
}> {
  switch (draft.actionType) {
    case 'spawn_agent':
      // Spawn agent requires Prime routing - defer to Prime control-plane
      // This is a placeholder - actual implementation would call Prime API
      return { createdRef: { type: 'agent', id: `agent-${Date.now()}` } }
    case 'tool_call':
      // Tool calls are routed through Prime session
      // This is a placeholder - actual implementation would call Prime API
      return { createdRef: { type: 'tool_call', id: `tool-call-${Date.now()}` } }
    case 'create_goal': {
      const inputs = draft.requiredInputs as { title: string; intent?: string; priority?: string }
      if (!inputs?.title) {
        throw new Error('Goal title is required')
      }
      const result = await createGoal({
        title: inputs.title,
        intent: inputs.intent,
        priority: inputs.priority,
        metadata: { threadId },
      })
      return { createdRef: { type: 'goal', id: result.id } }
    }
    case 'capture_artifact': {
      const inputs = draft.requiredInputs as { name: string; type: string; content: string }
      if (!inputs?.name || !inputs.type || !inputs.content) {
        throw new Error('Artifact name, type, and content are required')
      }
      if (!threadId) {
        throw new Error('Thread ID is required for artifact creation')
      }
      const result = await createArtifact(threadId, inputs)
      return { createdRef: { type: 'artifact', id: result.id } }
    }
    case 'add_note': {
      const inputs = draft.requiredInputs as { content: string }
      if (!inputs?.content) {
        throw new Error('Note content is required')
      }
      if (!threadId) {
        throw new Error('Thread ID is required for note creation')
      }
      const result = await addNote(threadId, inputs.content)
      return { createdRef: { type: 'note', id: result.id } }
    }
    default:
      throw new Error(`Unknown action type: ${draft.actionType}`)
  }
}
