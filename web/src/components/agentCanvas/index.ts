// ─────────────────────────────────────────────────────────────────────────────
// Agent Canvas UX Components (spec 017)
// Barrel exports for all agent canvas components
// ─────────────────────────────────────────────────────────────────────────────

export { AgentActivityBubble } from './AgentActivityBubble'
export type { AgentActivityBubbleProps } from './AgentActivityBubble'

export { DecisionActivityCard } from './DecisionActivityCard'
export type { DecisionActivityCardProps } from './DecisionActivityCard'

export { ContextAttachmentList } from './ContextAttachmentList'
export type { ContextAttachmentListProps } from './ContextAttachmentList'

export { DisplayStatusBadge } from './DisplayStatusBadge'
export type { DisplayStatusBadgeProps } from './DisplayStatusBadge'

export { CircuitNodeCard } from './CircuitNodeCard'
export type { CircuitNodeCardProps } from './CircuitNodeCard'

export { CircuitCanvasControls } from './CircuitCanvasControls'
export type { CircuitCanvasControlsProps } from './CircuitCanvasControls'

export { AgentActivityTimeline } from './AgentActivityTimeline'
export type { AgentActivityTimelineProps } from './AgentActivityTimeline'

export { BottomActionToolbar } from './BottomActionToolbar'
export type { BottomActionToolbarProps } from './BottomActionToolbar'

export { ToolbarActionComposer } from './ToolbarActionComposer'
export type { ToolbarActionComposerProps } from './ToolbarActionComposer'

// ─────────────────────────────────────────────────────────────────────────────
// Utility exports
// ─────────────────────────────────────────────────────────────────────────────

export type { ChatDisplayEvent, ContextAttachment, UserAction, DisplayStatus, ChatEventKind } from '../../types'
export {
  getStatusLabel,
  getStatusColorClass,
  getStatusIcon,
  isStatusActive,
  isStatusTerminal,
  formatDurationSince,
  deriveDisplayStatusFromKind,
  getStatusA11yText,
} from '../../lib/displayStatus'

export {
  getChatEventA11yText,
  getExpandButtonA11yText,
  getCardA11yText,
  getActionA11yText,
  getToolbarA11yText,
  getTimelineA11yText,
  getLiveRegionAnnouncement,
  KEYBOARD_HINTS,
  getFocusManagementText,
} from '../../lib/accessibilityText'

export {
  deriveChatEventsFromRuntime,
  mapThreadMessageToChatEvent,
  mapPrimeSessionToThinkingEvent,
  mapRuntimeEventToChatEvents,
  mapApprovalToChatEvent,
  mapDelegationToChatEvent,
  mapWorkItemToChatEvent,
  deriveContextAttachmentsFromEvent,
} from '../../lib/chatDisplayEvents'
