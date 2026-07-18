export interface ShowGate {
  ready(): void
  hydrated(): void
  dispose(): void
}

interface ShowGateOptions {
  timeoutMs: number
  onShow: () => void
  onTimeout: () => void
}

/**
 * Holds a window hidden until both first-paint prerequisites have arrived.
 * The timeout starts only once Electron says the window is paintable, so slow
 * window creation does not consume the renderer's recovery budget.
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
      timeout = setTimeout(() => show(true), timeoutMs)
      showIfComplete()
    },
    hydrated: () => {
      if (hydrated || shown) return
      hydrated = true
      showIfComplete()
    },
    dispose: () => {
      shown = true
      if (timeout !== undefined) clearTimeout(timeout)
    }
  }
}
