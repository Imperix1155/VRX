/**
 * tray.test.ts (VRX-112)
 *
 * Two layers: the pure template builder (no electron at all), and createTray's
 * click-time window resolution + wireWindow menu refresh (electron mocked with
 * just enough surface — Tray/Menu/nativeImage/app — to capture what the tray
 * wires up; the Codex regression on PR #118 lives in the second layer).
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

  it('wireWindow attaches show/hide menu-refresh listeners and syncs the menu', () => {
    const win = fakeWindow()
    const winListeners = new Map<string, () => void>()
    win.on = ((event: string, cb: () => void): void => {
      winListeners.set(event, cb)
    }) as never
    const { wireWindow } = createTray(() => win as never)

    captured.lastTemplate = []
    wireWindow(win as never)
    // Immediate sync: the menu was rebuilt with the visible-window label.
    expect(captured.lastTemplate[0]).toMatchObject({ label: 'Hide VRX' })
    expect([...winListeners.keys()].sort()).toEqual(['hide', 'show'])

    // A hide event refreshes the menu to the hidden-window label.
    win.isVisible = () => false
    winListeners.get('hide')!()
    expect(captured.lastTemplate[0]).toMatchObject({ label: 'Show VRX' })
  })

  it('tray actions no-op safely when no live window exists', () => {
    const only = fakeWindow()
    only.destroyed = true
    createTray(() => only as never)
    expect(() => captured.trayListeners.get('double-click')!()).not.toThrow()
    expect(only.show).not.toHaveBeenCalled()
  })
})
