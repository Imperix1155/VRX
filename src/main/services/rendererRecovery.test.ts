import { expect, it, vi } from 'vitest'
import type { MessageBoxOptions } from 'electron'
import { createRendererRecovery } from './rendererRecovery'
class RecoveryHarness {
  private resolveDialog!: (value: { response: number }) => void
  private rejectDialog!: (error: Error) => void
  window = {
    isDestroyed: vi.fn(() => false),
    reload: vi.fn(),
    webContents: { forcefullyCrashRenderer: vi.fn() }
  }
  showDialog = vi.fn<(options: MessageBoxOptions) => Promise<{ response: number }>>(
    () =>
      new Promise((resolve, reject) => {
        this.resolveDialog = resolve
        this.rejectDialog = reject
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
  expect(x.showDialog.mock.calls.at(-1)?.[0]).toMatchObject({ title: 'VRX — Renderer Crashed' })
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
  x.recovery.crashed('killed', 0)
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
