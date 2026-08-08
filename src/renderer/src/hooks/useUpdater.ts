import { useEffect, useRef, useState } from 'react'
import type { UpdaterSnapshot } from '@shared/ipc'

const DEFAULT_STATE: UpdaterSnapshot = {
  state: 'idle',
  currentVersion: __APP_VERSION__,
  availableVersion: null,
  progressPercent: 0,
  errorMessage: null
}

/**
 * Live updater state + actions (VRX-113).
 *
 * Captures the current snapshot on mount, subscribes to main-process pushes,
 * and exposes manual check/download/install actions. Guards `window.vrx`
 * absence so Preview/tests degrade gracefully. Swallows invoke failures:
 * rate-limit / missing-service errors are signaled by button state, not crashes.
 */
export function useUpdater(): {
  state: UpdaterSnapshot
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
} {
  const [state, setState] = useState<UpdaterSnapshot>(DEFAULT_STATE)
  const hasPushRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.vrx) return
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
      if (active) setState(snapshot)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const check = async (): Promise<void> => {
    if (typeof window === 'undefined' || !window.vrx?.checkForUpdates) return
    try {
      await window.vrx.checkForUpdates()
    } catch {
      // Swallow: the UI already disables the button / shows state.
    }
  }

  const download = async (): Promise<void> => {
    if (typeof window === 'undefined' || !window.vrx?.downloadUpdate) return
    try {
      await window.vrx.downloadUpdate()
    } catch {
      // Swallow: the UI already disables the button / shows state.
    }
  }

  const install = async (): Promise<void> => {
    if (typeof window === 'undefined' || !window.vrx?.installUpdate) return
    try {
      await window.vrx.installUpdate()
    } catch {
      // Swallow: the UI already disables the button / shows state.
    }
  }

  return { state, check, download, install }
}
