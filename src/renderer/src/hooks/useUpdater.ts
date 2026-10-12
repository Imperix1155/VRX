import { useEffect, useRef, useState } from 'react'
import type { UpdaterSnapshot } from '@shared/ipc'

const DEFAULT_STATE: UpdaterSnapshot = {
  state: 'idle',
  currentVersion: __APP_VERSION__,
  availableVersion: null,
  progressPercent: 0,
  failure: null
}

/**
 * Live updater state + actions (VRX-113).
 *
 * Captures the current snapshot on mount, subscribes to main-process pushes,
 * and exposes manual check/download/install actions. Guards `window.vrx`
 * absence so Preview/tests degrade gracefully. A rejected action (rate limit,
 * missing service) never throws; it sets `actionFailed` until the next action
 * or state push, because main sends no state change for a refused call.
 */
export function useUpdater(): {
  state: UpdaterSnapshot
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
  actionFailed: boolean
} {
  const [state, setState] = useState<UpdaterSnapshot>(DEFAULT_STATE)
  const [actionFailed, setActionFailed] = useState(false)
  const hasPushRef = useRef(false)

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !window.vrx ||
      typeof window.vrx.getUpdaterState !== 'function' ||
      typeof window.vrx.onUpdaterStateChanged !== 'function'
    ) {
      return
    }
    const bridge = window.vrx
    let active = true

    void bridge
      .getUpdaterState()
      .then((snapshot) => {
        // Push always wins the ordering race against the initial fetch.
        if (active && !hasPushRef.current) setState(snapshot)
      })
      .catch(() => {
        // Swallow: missing service / rate limit; the button states carry feedback.
      })

    const unsubscribe = bridge.onUpdaterStateChanged((snapshot) => {
      hasPushRef.current = true
      if (!active) return
      setState(snapshot)
      setActionFailed(false)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const run = async (
    pick: (bridge: NonNullable<Window['vrx']>) => (() => Promise<unknown>) | undefined
  ): Promise<void> => {
    const bridge = typeof window === 'undefined' ? undefined : window.vrx
    const action = bridge ? pick(bridge) : undefined
    if (!action) return
    setActionFailed(false)
    try {
      await action()
    } catch {
      setActionFailed(true)
    }
  }

  const check = (): Promise<void> =>
    run((bridge) => (bridge.checkForUpdates ? () => bridge.checkForUpdates() : undefined))
  const download = (): Promise<void> =>
    run((bridge) => (bridge.downloadUpdate ? () => bridge.downloadUpdate() : undefined))
  const install = (): Promise<void> =>
    run((bridge) => (bridge.installUpdate ? () => bridge.installUpdate() : undefined))

  return { state, check, download, install, actionFailed }
}
