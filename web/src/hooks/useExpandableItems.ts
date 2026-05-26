// ─────────────────────────────────────────────────────────────────────────────
// Expandable Items Hook (spec 017)
// Manage expand/collapse state for bubbles and cards
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useCallback } from 'react'

/**
 * Options for the expandable items hook
 */
export interface UseExpandableItemsOptions<T extends { id: string }> {
  /** Initial expanded item IDs */
  initialExpandedIds?: string[]
  /** Callback when expanded IDs change */
  onExpandedIdsChange?: (expandedIds: Set<string>) => void
}

/**
 * Result from the expandable items hook
 */
export interface UseExpandableItemsResult<T extends { id: string }> {
  /** Set of currently expanded item IDs */
  expandedIds: Set<string>
  /** Toggle expansion for a single item */
  toggleExpand: (id: string) => void
  /** Expand all items */
  expandAll: () => void
  /** Collapse all items */
  collapseAll: () => void
  /** Check if an item is expanded */
  isExpanded: (id: string) => boolean
  /** Expand a specific item */
  expand: (id: string) => void
  /** Collapse a specific item */
  collapse: (id: string) => void
}

/**
 * Hook to manage expand/collapse state for items
 */
export function useExpandableItems<T extends { id: string }>(
  items: T[],
  options: UseExpandableItemsOptions<T> = {},
): UseExpandableItemsResult<T> {
  const { initialExpandedIds = [], onExpandedIdsChange } = options

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(initialExpandedIds))

  // Notify parent of changes
  const updateExpandedIds = useCallback(
    (newExpandedIds: Set<string>) => {
      setExpandedIds(newExpandedIds)
      if (onExpandedIdsChange) {
        onExpandedIdsChange(newExpandedIds)
      }
    },
    [onExpandedIdsChange],
  )

  // Toggle expansion for a single item
  const toggleExpand = useCallback(
    (id: string) => {
      setExpandedIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) {
          next.delete(id)
        } else {
          next.add(id)
        }
        return next
      })
    },
    [],
  )

  // Expand all items
  const expandAll = useCallback(() => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      items.forEach((item) => next.add(item.id))
      return next
    })
  }, [items])

  // Collapse all items
  const collapseAll = useCallback(() => {
    setExpandedIds(new Set())
  }, [])

  // Check if an item is expanded
  const isExpanded = useCallback(
    (id: string) => expandedIds.has(id),
    [expandedIds],
  )

  // Expand a specific item
  const expand = useCallback(
    (id: string) => {
      setExpandedIds((prev) => {
        const next = new Set(prev)
        next.add(id)
        return next
      })
    },
    [],
  )

  // Collapse a specific item
  const collapse = useCallback(
    (id: string) => {
      setExpandedIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    },
    [],
  )

  return {
    expandedIds,
    toggleExpand,
    expandAll,
    collapseAll,
    isExpanded,
    expand,
    collapse,
  }
}

/**
 * Hook for managing a single expandable item
 */
export function useSingleExpandable(
  initialExpanded = false,
): {
  isExpanded: boolean
  toggleExpand: () => void
  expand: () => void
  collapse: () => void
} {
  const [isExpanded, setIsExpanded] = useState(initialExpanded)

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev)
  }, [])

  const expand = useCallback(() => {
    setIsExpanded(true)
  }, [])

  const collapse = useCallback(() => {
    setIsExpanded(false)
  }, [])

  return {
    isExpanded,
    toggleExpand,
    expand,
    collapse,
  }
}
