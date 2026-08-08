import { useEffect, useState } from 'react'
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
 * absence so Preview/tests degrade gracefully.
 */
export function useUpdater(): {
  state: UpdaterSnapshot
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
} {
  const [state, setState] = useState<UpdaterSnapshot>(DEFAULT_STATE)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.vrx) return
    const bridge = window.vrx
    let active = true

    void bridge.getUpdaterState().then((snapshot) => {
      if (active) setState(snapshot)
    })

    const unsubscribe = bridge.onUpdaterStateChanged((snapshot) => {
      if (active) setState(snapshot)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const check = async (): Promise<void> => {
    if (typeof window === 'undefined' || !window.vrx?.checkForUpdates) return
    await window.vrx.checkForUpdates()
  }

  const download = async (): Promise<void> => {
    if (typeof window === 'undefined' || !window.vrx?.downloadUpdate) return
    await window.vrx.downloadUpdate()
  }

  const install = async (): Promise<void> => {
    if (typeof window === 'undefined' || !window.vrx?.installUpdate) return
    await window.vrx.installUpdate()
  }

  return { state, check, download, install }
}
