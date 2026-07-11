import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')

describe('main native notification wiring', () => {
  it('includes the packaged app icon on native notifications (VRX-82)', () => {
    expect(source).toContain('new NativeNotification({ title, body, icon })')
  })

  it('pins the VRX-204 Title Case toast headers (owner: headers capitalize every word)', () => {
    expect(source).toContain("title = 'Friend Online'")
    expect(source).toContain("title = 'Friend Joined a World'")
    expect(source).toContain("title = 'Friend Offline'")
    expect(source).toContain("title = 'Friends Gathering'")
  })

  it('keeps the owner-authored hot-instance world and worldless copy (VRX-85)', () => {
    expect(source).toContain(
      '`${alert.friendCount} friends are in ${strippedWorldName} — join them?`'
    )
    expect(source).toContain('`${alert.friendCount} friends are in the same world — join them?`')
  })

  it('keeps cold/GC Windows activations focused without treating every activation as a click', () => {
    expect(source).toContain('NativeNotification.handleActivation(focusMainWindow)')
    expect(source).not.toContain('NativeNotification.handleActivation(focusDashboard)')
  })

  it('queues a dashboard click until the recreated renderer finishes loading', () => {
    expect(source).toContain(
      'dashboardNavigation.request(window, rendererReadyWindows.has(window))'
    )
    expect(source).toContain("mainWindow.webContents.on('did-finish-load'")
    expect(source).toContain('dashboardNavigation.rendererReady(mainWindow)')
  })
})
