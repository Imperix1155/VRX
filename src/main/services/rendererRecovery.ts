import type { MessageBoxOptions } from 'electron'
import { mt } from '../i18n'

interface RecoveryWindow {
  isDestroyed(): boolean
  reload(): void
  webContents: { forcefullyCrashRenderer(): void; isCrashed(): boolean }
}
interface RecoveryDependencies {
  window: RecoveryWindow
  showDialog: (options: MessageBoxOptions) => Promise<{ response: number }>
  onError: (error: unknown) => void
  /** True once the app is quitting: a renderer that goes away then needs no recovery. */
  isQuitting?: () => boolean
}

export interface RendererRecovery {
  crashed(reason: string, exitCode: number): void
  unresponsive(): void
  /** The window answers again: a hang box still open closes as if Wait was pressed. */
  responsive(): void
  /** The user asked to see the window: reload a renderer that a dismissed crash box left empty. */
  revive(): void
}

/** One dialog owner per window, shared by hangs and crashes. */
export function createRendererRecovery({
  window,
  showDialog,
  onError,
  isQuitting = () => false
}: RecoveryDependencies): RendererRecovery {
  let active = false
  let closeHangDialog: AbortController | undefined
  let pendingCrash: { exitCode: number } | undefined
  // Set while the hang path's own forced kill is on its way, so only that one
  // 'killed' is expected. Any other kill (e.g. Task Manager) is a crash.
  let expectingKill = false

  async function show(kind: 'hang' | 'crash'): Promise<void> {
    if (active || window.isDestroyed()) return
    active = true
    const crash = pendingCrash
    pendingCrash = undefined
    const hangClose = kind === 'hang' ? new AbortController() : undefined
    closeHangDialog = hangClose
    let reloaded = false
    try {
      const { response } = await showDialog(
        kind === 'crash'
          ? {
              type: 'error',
              title: mt('recovery.crash.title'),
              message: mt('recovery.crash.message'),
              // Only the exit code: the raw reason is a developer word.
              detail: mt('recovery.crash.detail', { exitCode: String(crash?.exitCode) }),
              buttons: [mt('recovery.reload'), mt('recovery.dismiss')],
              defaultId: 0,
              cancelId: 1
            }
          : {
              type: 'warning',
              title: mt('recovery.hang.title'),
              message: mt('recovery.hang.message'),
              detail: mt('recovery.hang.detail'),
              buttons: [mt('recovery.reload'), mt('recovery.wait')],
              defaultId: 0,
              cancelId: 1,
              signal: hangClose?.signal
            }
      )
      if (!window.isDestroyed() && response === 0) {
        // A crash supersedes a hang: never force-kill an already dead renderer.
        if (kind === 'hang' && !pendingCrash) {
          expectingKill = true
          window.webContents.forcefullyCrashRenderer()
        }
        window.reload()
        reloaded = true
      }
    } catch (error) {
      onError(error)
    } finally {
      active = false
      if (closeHangDialog === hangClose) closeHangDialog = undefined
      if (reloaded) pendingCrash = undefined
      // A hang's Wait cannot dismiss a later crash that needs recovery.
      if (kind === 'hang' && pendingCrash && !window.isDestroyed()) void show('crash')
    }
  }

  return {
    crashed(reason, exitCode) {
      if (reason === 'killed' && expectingKill) {
        expectingKill = false
        return
      }
      if (reason === 'clean-exit' || isQuitting() || window.isDestroyed()) return
      if (!active || !pendingCrash) pendingCrash = { exitCode }
      void show('crash')
    },
    unresponsive() {
      void show('hang')
    },
    responsive() {
      // A box left open would offer Reload, which would kill a window that works again.
      closeHangDialog?.abort()
    },
    revive() {
      // An open box owns the answer; a working renderer needs nothing.
      if (active || window.isDestroyed() || !window.webContents.isCrashed()) return
      window.reload()
    }
  }
}
