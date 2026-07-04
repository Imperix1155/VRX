/**
 * tray.test.ts (VRX-112)
 *
 * Unit-tests the pure template builder only. electron is neutralized with a
 * bare mock so importing tray.ts (which pulls in Tray/Menu/nativeImage at
 * module scope) doesn't touch the real module — createTray itself is not
 * exercised here.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
vi.mock('../../resources/icon.png?asset', () => ({ default: '/fake/icon.png' }))

import { buildTrayMenuTemplate } from './tray'

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
