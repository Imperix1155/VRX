export interface ShowGate {
  ready(): void
  hydrated(): void
  /**
   * Someone asked for the window (tray, second launch, alert click). Starts the
   * fallback timeout if it isn't running, so a window that never says it can
   * paint still shows (VRX-185).
   */
  requested(): void
  dispose(): void
  /** True once the gate has shown the window (or was disposed with it). */
  isShown(): boolean
}

interface ShowGateOptions {
  timeoutMs: number
  onShow: () => void
  onTimeout: () => void
}

/**
 * Holds a window hidden until both first-paint prerequisites have arrived.
 * The timeout starts once Electron says the window is paintable, so slow
 * window creation does not consume the renderer's recovery budget, or once
 * someone asks for the window, whichever comes first.
 */
export function createShowGate({ timeoutMs, onShow, onTimeout }: ShowGateOptions): ShowGate {
  let ready = false
  let hydrated = false
  let shown = false
  let timeout: ReturnType<typeof setTimeout> | undefined

  const show = (timedOut: boolean): void => {
    if (shown) return
    shown = true
    if (timeout !== undefined) clearTimeout(timeout)
    if (timedOut) onTimeout()
    onShow()
  }

  const showIfComplete = (): void => {
    if (ready && hydrated) show(false)
  }

  return {
    ready: () => {
      if (ready || shown) return
      ready = true
      // A request may have started the fallback already; it keeps running.
      timeout ??= setTimeout(() => show(true), timeoutMs)
      showIfComplete()
    },
    hydrated: () => {
      if (hydrated || shown) return
      hydrated = true
      showIfComplete()
    },
    requested: () => {
      if (shown) return
      timeout ??= setTimeout(() => show(true), timeoutMs)
    },
    dispose: () => {
      shown = true
      if (timeout !== undefined) clearTimeout(timeout)
    },
    isShown: () => shown
  }
}
