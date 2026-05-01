import { EventFeed } from '../components/EventFeed'
import { useWebSocket } from '../hooks/useWebSocket'

export function LiveFeed() {
  const { events, connected } = useWebSocket('/ws')
  return <EventFeed events={events} connected={connected} />
}
