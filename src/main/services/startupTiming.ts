export interface StartupTimingSnapshot {
  windowReadyMs: number | null
  firstRenderMs: number | null
}

export class StartupTiming {
  private createdAt: number | null = null
  private windowReadyMs: number | null = null
  private firstRenderMs: number | null = null

  rememberProcessStart(epochMs: number): void {
    if (this.createdAt !== null) return
    if (!Number.isFinite(epochMs) || epochMs <= 0) return
    this.createdAt = epochMs
  }

  noteWindowReady(now: number): void {
    if (this.windowReadyMs !== null || this.createdAt === null || !Number.isFinite(now)) return
    this.windowReadyMs = Math.max(0, Math.round(now - this.createdAt))
  }

  noteFirstRender(now: number): void {
    if (this.firstRenderMs !== null || this.createdAt === null || !Number.isFinite(now)) return
    this.firstRenderMs = Math.max(0, Math.round(now - this.createdAt))
  }

  snapshot(): StartupTimingSnapshot {
    return { windowReadyMs: this.windowReadyMs, firstRenderMs: this.firstRenderMs }
  }
}

export const startupTiming = new StartupTiming()
