export interface PrimeMessageEvent {
  type: 'prime.message'
  payload: {
    thread_id: string
    message_id: string
    content: string
    sender: string
  }
}

export interface CronFastEvent {
  type: 'cron.fast'
  payload: {
    triggered_at: string
    source?: string
  }
}

export interface FleetDelegationCompletedEvent {
  type: 'fleet.delegation.completed'
  payload: {
    delegation_id: string
    work_item_id?: string
    agent_id?: string
    result?: Record<string, unknown>
  }
}

export interface FleetDelegationFailedEvent {
  type: 'fleet.delegation.failed'
  payload: {
    delegation_id: string
    work_item_id?: string
    agent_id?: string
    error: string
  }
}

export interface GoalCreatedEvent {
  type: 'goal.created'
  payload: {
    goal_id: string
    title: string
    intent: string
  }
}

export type PrimeEvent =
  | PrimeMessageEvent
  | CronFastEvent
  | FleetDelegationCompletedEvent
  | FleetDelegationFailedEvent
  | GoalCreatedEvent
