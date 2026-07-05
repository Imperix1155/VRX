/**
 * tray.test.ts (VRX-112)
 *
 * Unit-tests the pure template builder only. electron is neutralized with a
 * bare mock so importing tray.ts (which pulls in Tray/Menu/nativeImage at
 * module scope) doesn't touch the real module — createTray itself is not
 * exercised here.
 */
import { describe, expect, it, vi } from 'vitest'

// Enough electron surface for createTray: Tray/Menu capture what they're given,
// nativeImage returns a stub, app.quit is spied.
const captured = vi.hoisted(() => ({
  lastTemplate: [] as unknown[],
  trayListeners: new Map<string, () => void>(),
  quit: vi.fn()
}))
vi.mock('electron', () => ({
  app: { quit: captured.quit },
  Menu: { buildFromTemplate: (t: unknown[]) => (captured.lastTemplate = t) },
  Tray: class {
    setToolTip = vi.fn()
    setContextMenu = vi.fn()
    on(event: string, cb: () => void): void {
      captured.trayListeners.set(event, cb)
    }
  },
  nativeImage: { createFromPath: () => ({ resize: (): object => ({}) }) }
}))
vi.mock('../../resources/icon.png?asset', () => ({ default: '/fake/icon.png' }))

import { buildTrayMenuTemplate, createTray } from './tray'

/** Minimal BrowserWindow stand-in for click-time resolution tests. */
function fakeWindow(): {
  show: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  hide: ReturnType<typeof vi.fn>
  isVisible: () => boolean
  isDestroyed: () => boolean
  on: () => void
  destroyed: boolean
} {
  const win = {
    show: vi.fn(),
    focus: vi.fn(),
    hide: vi.fn(),
    isVisible: () => true,
    isDestroyed: () => win.destroyed,
    on: (): void => {},
    destroyed: false
  }
  return win
}

describe('buildTrayMenuTemplate', () => {
  it('shows "Show VRX" when the window is hidden', () => {
    const onShow = vi.fn()
    const onHide = vi.fn()
    const onQuit = vi.fn()
    const template = buildTrayMenuTemplate({ isVisible: false, onShow, onHide, onQuit })

    expect(template[0]).toMatchObject({ label: 'Show VRX' })
    ;(template[0] as { click: () => void }).click()
    expect(onShow).toHaveBeenCalledOnce()
    expect(onHide).not.toHaveBeenCalled()
  })

  it('shows "Hide VRX" when the window is visible', () => {
    const onShow = vi.fn()
    const onHide = vi.fn()
    const onQuit = vi.fn()
    const template = buildTrayMenuTemplate({ isVisible: true, onShow, onHide, onQuit })

    expect(template[0]).toMatchObject({ label: 'Hide VRX' })
    ;(template[0] as { click: () => void }).click()
    expect(onHide).toHaveBeenCalledOnce()
    expect(onShow).not.toHaveBeenCalled()
  })

  it('includes a separator and a Quit VRX item wired to onQuit', () => {
    const onQuit = vi.fn()
    const template = buildTrayMenuTemplate({
      isVisible: true,
      onShow: vi.fn(),
      onHide: vi.fn(),
      onQuit
    })

    expect(template[1]).toEqual({ type: 'separator' })
    expect(template[2]).toMatchObject({ label: 'Quit VRX' })
    ;(template[2] as { click: () => void }).click()
    expect(onQuit).toHaveBeenCalledOnce()
  })
})

describe('createTray — click-time window resolution (Codex regression, PR #118)', () => {
  it('tray actions target the CURRENT window after the original is destroyed and replaced', () => {
    const first = fakeWindow()
    let current: unknown = first
    createTray(() => current as never)

    // macOS native close: the first window is destroyed; activate creates a new one.
    first.destroyed = true
    const second = fakeWindow()
    current = second

    // Double-click resolves at click time → acts on the REPLACEMENT window.
    captured.trayListeners.get('double-click')!()
    expect(first.show).not.toHaveBeenCalled()
    expect(second.show).toHaveBeenCalledOnce()
    expect(second.focus).toHaveBeenCalledOnce()
  })

  it('tray actions no-op safely when no live window exists', () => {
    const only = fakeWindow()
    only.destroyed = true
    createTray(() => only as never)
    expect(() => captured.trayListeners.get('double-click')!()).not.toThrow()
    expect(only.show).not.toHaveBeenCalled()
  })
})
