import { afterEach, expect, it, vi } from 'vitest'
import type { MessageBoxOptions } from 'electron'
import { setMainLocale } from '../i18n'
import { createRendererRecovery } from './rendererRecovery'
class RecoveryHarness {
  private resolveDialog!: (value: { response: number }) => void
  private rejectDialog!: (error: Error) => void
  window = {
    isDestroyed: vi.fn(() => false),
    reload: vi.fn(),
    webContents: { forcefullyCrashRenderer: vi.fn(), isCrashed: vi.fn(() => false) }
  }
  showDialog = vi.fn<(options: MessageBoxOptions) => Promise<{ response: number }>>(
    (options) =>
      new Promise((resolve, reject) => {
        this.resolveDialog = resolve
        this.rejectDialog = reject
        // Electron closes an aborted box as if it was cancelled.
        options.signal?.addEventListener('abort', () =>
          resolve({ response: options.cancelId ?? 0 })
        )
      })
  )
  onError = vi.fn()
  recovery = createRendererRecovery({
    window: this.window,
    showDialog: this.showDialog,
    onError: this.onError
  })
  resolve(response: number): void {
    this.resolveDialog({ response })
  }
  reject(): void {
    this.rejectDialog(new Error('closed'))
  }
}
afterEach(() => {
  setMainLocale('en')
})
it('owns one dialog across repeated hang and crash events and reloads only once', async () => {
  const x = new RecoveryHarness()
  x.recovery.unresponsive()
  x.recovery.unresponsive()
  x.recovery.crashed('oom', 1)
  expect(x.showDialog).toHaveBeenCalledOnce()
  x.resolve(0)
  await Promise.resolve()
  await Promise.resolve()
  expect(x.window.reload).toHaveBeenCalledOnce()
  expect(x.window.webContents.forcefullyCrashRenderer).not.toHaveBeenCalled()
})
it('offers crash recovery after Wait when a hang became a crash', async () => {
  const x = new RecoveryHarness()
  x.recovery.unresponsive()
  x.recovery.crashed('oom', 1)
  x.resolve(1)
  await Promise.resolve()
  await Promise.resolve()
  expect(x.showDialog).toHaveBeenCalledTimes(2)
  expect(x.showDialog.mock.calls.at(-1)?.[0]).toMatchObject({
    title: 'VRX — Window Stopped Working'
  })
})
it('releases ownership after rejection and never acts on a destroyed window', async () => {
  const x = new RecoveryHarness()
  x.recovery.unresponsive()
  x.reject()
  await Promise.resolve()
  await Promise.resolve()
  expect(x.onError).toHaveBeenCalledOnce()
  x.recovery.unresponsive()
  expect(x.showDialog).toHaveBeenCalledTimes(2)
  x.window.isDestroyed.mockReturnValue(true)
  x.resolve(0)
  await Promise.resolve()
  expect(x.window.reload).not.toHaveBeenCalled()
  expect(x.window.webContents.forcefullyCrashRenderer).not.toHaveBeenCalled()
})
it('ignores intentional exits and suppresses the crash caused by its own hang reload', async () => {
  const x = new RecoveryHarness()
  x.recovery.crashed('clean-exit', 0)
  expect(x.showDialog).not.toHaveBeenCalled()
  x.window.webContents.forcefullyCrashRenderer.mockImplementation(() =>
    x.recovery.crashed('killed', 0)
  )
  x.recovery.unresponsive()
  x.resolve(0)
  await Promise.resolve()
  expect(x.window.webContents.forcefullyCrashRenderer).toHaveBeenCalledOnce()
  expect(x.window.reload).toHaveBeenCalledOnce()
  expect(x.showDialog).toHaveBeenCalledOnce()
  // Only that one expected kill is absorbed; a later external kill is a crash.
  x.recovery.crashed('killed', 1)
  expect(x.showDialog).toHaveBeenCalledTimes(2)
})

it('offers reload when the renderer is killed from outside the app', async () => {
  const x = new RecoveryHarness()
  x.recovery.crashed('killed', 1)
  expect(x.showDialog).toHaveBeenCalledOnce()
  expect(x.showDialog.mock.calls[0]?.[0]).toMatchObject({ title: 'VRX — Window Stopped Working' })
  x.resolve(0)
  await Promise.resolve()
  await Promise.resolve()
  expect(x.window.reload).toHaveBeenCalledOnce()
  expect(x.window.webContents.forcefullyCrashRenderer).not.toHaveBeenCalled()
})

it('offers no recovery for a renderer lost while the app is quitting', () => {
  let quitting = false
  const window = {
    isDestroyed: vi.fn(() => false),
    reload: vi.fn(),
    webContents: { forcefullyCrashRenderer: vi.fn(), isCrashed: vi.fn(() => false) }
  }
  const showDialog = vi.fn(() => Promise.resolve({ response: 0 }))
  const recovery = createRendererRecovery({
    window,
    showDialog,
    onError: vi.fn(),
    isQuitting: () => quitting
  })
  quitting = true
  recovery.crashed('killed', 1)
  recovery.crashed('oom', 1)
  expect(showDialog).not.toHaveBeenCalled()
  window.isDestroyed.mockReturnValue(true)
  quitting = false
  recovery.crashed('killed', 1)
  expect(showDialog).not.toHaveBeenCalled()
})

it('dismisses a crash dialog without reloading or terminating the renderer', async () => {
  const x = new RecoveryHarness()
  x.recovery.crashed('oom', 1)
  expect(x.showDialog.mock.calls[0]?.[0]).toMatchObject({
    buttons: ['Reload', 'Dismiss'],
    cancelId: 1
  })
  x.resolve(1)
  await Promise.resolve()
  await Promise.resolve()
  expect(x.window.reload).not.toHaveBeenCalled()
  expect(x.window.webContents.forcefullyCrashRenderer).not.toHaveBeenCalled()
  expect(x.onError).not.toHaveBeenCalled()
  x.recovery.crashed('oom', 1)
  expect(x.showDialog).toHaveBeenCalledTimes(2)
})

it('reloads a window left empty by a dismissed crash box once it is asked for again', async () => {
  const x = new RecoveryHarness()
  x.recovery.crashed('oom', 1)
  x.window.webContents.isCrashed.mockReturnValue(true)
  // Asked for while the crash box is still open: the box owns the answer.
  x.recovery.revive()
  expect(x.window.reload).not.toHaveBeenCalled()
  x.resolve(1)
  await Promise.resolve()
  await Promise.resolve()
  expect(x.window.reload).not.toHaveBeenCalled()

  // Tray Show, a second launch or an alert click brings it back.
  x.recovery.revive()
  expect(x.window.reload).toHaveBeenCalledOnce()
  expect(x.showDialog).toHaveBeenCalledOnce()
  expect(x.window.webContents.forcefullyCrashRenderer).not.toHaveBeenCalled()
})

it('never reloads a working or destroyed window when it is asked for', () => {
  const x = new RecoveryHarness()
  x.recovery.revive()
  x.window.webContents.isCrashed.mockReturnValue(true)
  x.window.isDestroyed.mockReturnValue(true)
  x.recovery.revive()
  expect(x.window.reload).not.toHaveBeenCalled()
})

it('closes the hang box as Wait once the window answers again', async () => {
  const x = new RecoveryHarness()
  x.recovery.unresponsive()
  const signal = x.showDialog.mock.calls[0]?.[0].signal
  expect(signal?.aborted).toBe(false)
  x.recovery.responsive()
  expect(signal?.aborted).toBe(true)
  await Promise.resolve()
  await Promise.resolve()
  // The window that recovered is kept: no forced kill, no reload.
  expect(x.window.webContents.forcefullyCrashRenderer).not.toHaveBeenCalled()
  expect(x.window.reload).not.toHaveBeenCalled()
  // The box is gone, so a later hang can ask again.
  x.recovery.unresponsive()
  expect(x.showDialog).toHaveBeenCalledTimes(2)
})

it('keeps the crash box open when the window reports it answers again', async () => {
  const x = new RecoveryHarness()
  x.recovery.crashed('crashed', 1)
  expect(x.showDialog.mock.calls[0]?.[0].signal).toBeUndefined()
  x.recovery.responsive()
  x.resolve(0)
  await Promise.resolve()
  await Promise.resolve()
  expect(x.window.reload).toHaveBeenCalledOnce()
})

it.each([
  ['en', 'oom'],
  ['ja', 'launch-failed']
] as const)('words the %s crash box for people, keeping only the error code', (locale, reason) => {
  setMainLocale(locale)
  const x = new RecoveryHarness()
  x.recovery.crashed(reason, -536870904)
  const options = x.showDialog.mock.calls[0]?.[0]
  const words = [options?.title, options?.message, options?.detail].join('\n')
  expect(words).not.toContain(reason)
  expect(words).not.toMatch(/renderer/i)
  expect(options?.detail).toContain('-536870904')
})
