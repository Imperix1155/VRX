import type { AppStatus, ConnectionHealth, Platform } from '@shared/types'

const CONNECTION_HEALTH = new Set<ConnectionHealth>(['live', 'reconnecting', 'down'])

function defaultHealth(): Record<Platform, ConnectionHealth> {
  return { vrchat: 'down', chilloutvr: 'down' }
}

function defaultReconcileTimes(): Record<Platform, number | null> {
  return { vrchat: null, chilloutvr: null }
}

/** Main-owned snapshot of the local platform pipelines and REST reconciles. */
export class AppStatusService {
  private readonly ws = defaultHealth()
  private readonly lastReconcileAt = defaultReconcileTimes()

  constructor(private readonly clock: () => number = Date.now) {}

  recordConnection(platform: Platform, health: unknown): void {
    this.ws[platform] = CONNECTION_HEALTH.has(health as ConnectionHealth)
      ? (health as ConnectionHealth)
      : 'down'
  }

  recordReconcile(platform: Platform): void {
    this.lastReconcileAt[platform] = this.clock()
  }

  snapshot(): AppStatus {
    return {
      ws: { ...this.ws },
      lastReconcileAt: { ...this.lastReconcileAt }
    }
  }
}
