import type { AdapterEvent, ConnectionHealth, Platform } from '@shared/types'

export interface AdapterEventSource {
  subscribe: (listener: (event: AdapterEvent) => void) => () => void
}

interface ConnectionStatusConsumer {
  recordConnection: (platform: Platform, health: ConnectionHealth) => void
}

interface AdapterEventConsumer {
  consume: (event: AdapterEvent) => void
}

interface AdapterWiringOptions {
  sources: readonly AdapterEventSource[]
  appStatus: ConnectionStatusConsumer
  locationAuthority: AdapterEventConsumer
  friendAlerts: AdapterEventConsumer
  broadcast: (event: AdapterEvent) => void
}

export function wireAdapterEvents({
  sources,
  appStatus,
  locationAuthority,
  friendAlerts,
  broadcast
}: AdapterWiringOptions): () => void {
  const handleAdapterEvent = (event: AdapterEvent): void => {
    if (event.type === 'connection') {
      appStatus.recordConnection(event.platform, event.health)
    }
    locationAuthority.consume(event)
    friendAlerts.consume(event)
    broadcast(event)
  }

  const unsubscribes = sources.map((source) => source.subscribe(handleAdapterEvent))
  return (): void => {
    for (const unsubscribe of unsubscribes) unsubscribe()
  }
}
