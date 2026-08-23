import { describe, expect, it, vi } from 'vitest'
import { installNavigationGuards } from './navigationGuards'

type WindowOpenHandler = (details: { url: string }) => { action: 'deny' }
type FrameNavigationHandler = (event: { url: string; preventDefault(): void }) => void

const createWebContents = (): {
  setWindowOpenHandler: (handler: WindowOpenHandler) => void
  on: (event: 'will-frame-navigate', handler: FrameNavigationHandler) => void
  windowOpenHandler: WindowOpenHandler | undefined
  frameNavigationHandler: FrameNavigationHandler | undefined
} => {
  const webContents = {
    windowOpenHandler: undefined as WindowOpenHandler | undefined,
    frameNavigationHandler: undefined as FrameNavigationHandler | undefined,
    setWindowOpenHandler(handler: WindowOpenHandler): void {
      webContents.windowOpenHandler = handler
    },
    on(event: 'will-frame-navigate', handler: FrameNavigationHandler): void {
      if (event === 'will-frame-navigate') webContents.frameNavigationHandler = handler
    }
  }

  return webContents
}

describe('installNavigationGuards', () => {
  it('opens an allowlisted new-window URL externally but never creates a window', () => {
    const webContents = createWebContents()
    const openExternal = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)

    installNavigationGuards({
      webContents,
      rendererEntry: 'http://localhost:5173/',
      isAllowedUrl: (url) => url === 'https://vrchat.com/home',
      openExternal,
      warn: vi.fn()
    })

    expect(webContents.windowOpenHandler?.({ url: 'https://vrchat.com/home' })).toEqual({
      action: 'deny'
    })
    expect(openExternal).toHaveBeenCalledWith('https://vrchat.com/home')
  })

  it('blocks and privacy-safely logs a disallowed new-window URL', () => {
    const webContents = createWebContents()
    const openExternal = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const warn = vi.fn()

    installNavigationGuards({
      webContents,
      rendererEntry: 'http://localhost:5173/',
      isAllowedUrl: () => false,
      openExternal,
      warn
    })

    expect(
      webContents.windowOpenHandler?.({ url: 'https://evil.example/private?token=secret-value' })
    ).toEqual({ action: 'deny' })
    expect(openExternal).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('navigation blocked', {
      scheme: 'https:',
      host: 'evil.example'
    })
    expect(warn).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ url: expect.anything() })
    )
  })

  it('blocks and privacy-safely logs frame navigation outside the loaded origin', () => {
    const webContents = createWebContents()
    const warn = vi.fn()
    const preventDefault = vi.fn()

    installNavigationGuards({
      webContents,
      rendererEntry: 'http://localhost:5173/',
      isAllowedUrl: () => false,
      openExternal: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      warn
    })

    webContents.frameNavigationHandler?.({
      url: 'https://evil.example/private?token=secret-value',
      preventDefault
    })

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith('navigation blocked', {
      scheme: 'https:',
      host: 'evil.example'
    })
  })

  it('allows frame navigation within the loaded development origin', () => {
    const webContents = createWebContents()
    const preventDefault = vi.fn()

    installNavigationGuards({
      webContents,
      rendererEntry: 'http://localhost:5173/',
      isAllowedUrl: () => false,
      openExternal: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      warn: vi.fn()
    })

    webContents.frameNavigationHandler?.({
      url: 'http://localhost:5173/settings?tab=behavior',
      preventDefault
    })

    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('allows only the exact packaged entry file', () => {
    const webContents = createWebContents()

    installNavigationGuards({
      webContents,
      rendererEntry:
        'file:///Applications/VRX.app/Contents/Resources/app.asar/out/renderer/index.html',
      isAllowedUrl: () => false,
      openExternal: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      warn: vi.fn()
    })

    const exactEntryPreventDefault = vi.fn()
    webContents.frameNavigationHandler?.({
      url: 'file:///Applications/VRX.app/Contents/Resources/app.asar/out/renderer/index.html',
      preventDefault: exactEntryPreventDefault
    })
    expect(exactEntryPreventDefault).not.toHaveBeenCalled()

    const siblingFilePreventDefault = vi.fn()
    webContents.frameNavigationHandler?.({
      url: 'file:///Applications/VRX.app/Contents/Resources/app.asar/out/renderer/other.html',
      preventDefault: siblingFilePreventDefault
    })
    expect(siblingFilePreventDefault).toHaveBeenCalledOnce()
  })
})
