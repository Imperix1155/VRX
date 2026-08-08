import type { AdapterEvent, ConnectionHealth, Platform } from '@shared/types'

import log from './logger'

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

function formatConsumerError(err: unknown): string {
  // Total by construction: String() itself can throw for hostile values
  // (null-prototype objects, throwing toString/Symbol.toPrimitive) — and a
  // throw HERE would escape the guard and reinstate the exact defect this
  // module exists to prevent.
  try {
    return err instanceof Error ? err.message : String(err)
  } catch {
    return '[unformattable error]'
  }
}

function runConsumerSafely(name: string, eventType: string, run: () => void): void {
  try {
    run()
  } catch (err) {
    log.warn('adapter event consumer failed', {
      consumer: name,
      eventType,
      error: formatConsumerError(err)
    })
  }
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
      runConsumerSafely('appStatus', event.type, () => {
        appStatus.recordConnection(event.platform, event.health)
      })
    }
    runConsumerSafely('locationAuthority', event.type, () => {
      locationAuthority.consume(event)
    })
    runConsumerSafely('friendAlerts', event.type, () => {
      friendAlerts.consume(event)
    })
    runConsumerSafely('broadcast', event.type, () => {
      broadcast(event)
    })
  }

  const unsubscribes = sources.map((source) => source.subscribe(handleAdapterEvent))
  return (): void => {
    for (const unsubscribe of unsubscribes) unsubscribe()
  }
}
