/**
 * Runs `run` once a burst of triggers pauses for `settleMs`, or every
 * `maxWaitMs` while they keep coming, so a storm of events becomes a few
 * reads instead of one per event. `cancel` drops a run that is waiting.
 */
export interface Coalesced {
  trigger: () => void
  cancel: () => void
}

export function coalesce(run: () => void, settleMs: number, maxWaitMs: number): Coalesced {
  let timer: ReturnType<typeof setTimeout> | null = null
  let firstAt: number | null = null
  const fire = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    firstAt = null
    run()
  }
  return {
    trigger: () => {
      const now = Date.now()
      firstAt ??= now
      if (timer !== null) clearTimeout(timer)
      if (now - firstAt >= maxWaitMs) {
        fire()
        return
      }
      timer = setTimeout(fire, settleMs)
    },
    cancel: () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
      firstAt = null
    }
  }
}

/**
 * One waiting run whose delay the caller picks each time (a backoff).
 * `schedule` does nothing while a run is already waiting and says whether it
 * started one; `cancel` drops a run that is waiting.
 */
export interface Delayed {
  schedule: (delayMs: number) => boolean
  cancel: () => void
}

export function delayed(run: () => void): Delayed {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    schedule: (delayMs) => {
      if (timer !== null) return false
      timer = setTimeout(() => {
        timer = null
        run()
      }, delayMs)
      return true
    },
    cancel: () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
    }
  }
}
