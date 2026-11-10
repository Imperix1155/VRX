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
