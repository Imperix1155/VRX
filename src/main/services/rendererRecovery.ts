import type { MessageBoxOptions } from 'electron'

interface RecoveryWindow {
  isDestroyed(): boolean
  reload(): void
  webContents: { forcefullyCrashRenderer(): void }
}
interface RecoveryDependencies {
  window: RecoveryWindow
  showDialog: (options: MessageBoxOptions) => Promise<{ response: number }>
  onError: (error: unknown) => void
}

/** One dialog owner per window, shared by hangs and crashes. */
export function createRendererRecovery({ window, showDialog, onError }: RecoveryDependencies): {
  crashed(reason: string, exitCode: number): void
  unresponsive(): void
} {
  let active = false
  let pendingCrash: { reason: string; exitCode: number } | undefined

  async function show(kind: 'hang' | 'crash'): Promise<void> {
    if (active || window.isDestroyed()) return
    active = true
    const crash = pendingCrash
    pendingCrash = undefined
    let reloaded = false
    try {
      const { response } = await showDialog(
        kind === 'crash'
          ? {
              type: 'error',
              title: 'VRX — Renderer Crashed',
              message: 'The window has stopped responding due to an unexpected error.',
              detail: `Reason: ${crash?.reason} (exit code ${crash?.exitCode})`,
              buttons: ['Reload', 'Dismiss'],
              defaultId: 0,
              cancelId: 1
            }
          : {
              type: 'warning',
              title: 'VRX — Window Not Responding',
              message: 'VRX is not responding.',
              detail: 'The window may be busy. You can wait or reload it.',
              buttons: ['Reload', 'Wait'],
              defaultId: 0,
              cancelId: 1
            }
      )
      if (!window.isDestroyed() && response === 0) {
        // A crash supersedes a hang: never force-kill an already dead renderer.
        if (kind === 'hang' && !pendingCrash) window.webContents.forcefullyCrashRenderer()
        window.reload()
        reloaded = true
      }
    } catch (error) {
      onError(error)
    } finally {
      active = false
      if (reloaded) pendingCrash = undefined
      // A hang's Wait cannot dismiss a later crash that needs recovery.
      if (kind === 'hang' && pendingCrash && !window.isDestroyed()) void show('crash')
    }
  }

  return {
    crashed(reason, exitCode) {
      if (reason === 'clean-exit' || reason === 'killed' || window.isDestroyed()) return
      if (!active || !pendingCrash) pendingCrash = { reason, exitCode }
      void show('crash')
    },
    unresponsive() {
      void show('hang')
    }
  }
}
