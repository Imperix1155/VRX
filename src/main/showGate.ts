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
  /**
   * Start with your computer, In the tray: the window gets ready as usual but
   * stays hidden until someone asks for it (`requested`). Then it shows at
   * once if it can already paint, or as soon as it can.
   */
  startHidden?: boolean
}

/**
 * Holds a window hidden until both first-paint prerequisites have arrived
 * (and, with `startHidden`, until it is asked for).
 * The timeout starts once Electron says the window is paintable, so slow
 * window creation does not consume the renderer's recovery budget, or once
 * someone asks for the window, whichever comes first.
 */
export function createShowGate({
  timeoutMs,
  onShow,
  onTimeout,
  startHidden = false
}: ShowGateOptions): ShowGate {
  let ready = false
  let hydrated = false
  let shown = false
  /** Held in the tray until asked for. */
  let held = startHidden
  /** While held: the window could have shown already (painted, or timed out). */
  let couldShow = false
  let timeout: ReturnType<typeof setTimeout> | undefined

  const show = (timedOut: boolean): void => {
    if (shown) return
    if (held) {
      // Nothing waited on a hidden window, so a slow start is not worth a warning.
      couldShow = true
      return
    }
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
      if (held) {
        held = false
        if (couldShow) {
          show(false)
          return
        }
      }
      timeout ??= setTimeout(() => show(true), timeoutMs)
    },
    dispose: () => {
      shown = true
      if (timeout !== undefined) clearTimeout(timeout)
    },
    isShown: () => shown
  }
}
