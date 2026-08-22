type WindowOpenHandler = (details: { url: string }) => { action: 'deny' }
type FrameNavigationHandler = (event: { url: string; preventDefault(): void }) => void

type NavigationGuardWebContents = {
  setWindowOpenHandler: (handler: WindowOpenHandler) => void
  on: (event: 'will-frame-navigate', handler: FrameNavigationHandler) => void
}

type NavigationGuardOptions = {
  webContents: NavigationGuardWebContents
  rendererEntry: string
  isAllowedUrl: (url: string) => boolean
  openExternal: (url: string) => Promise<unknown>
  warn: (message: string, metadata: { scheme: string; host: string }) => void
}

function navigationMetadata(rawUrl: string): { scheme: string; host: string } {
  try {
    const url = new URL(rawUrl)
    return { scheme: url.protocol, host: url.hostname }
  } catch {
    return { scheme: '[unparseable]', host: '[unparseable]' }
  }
}

/**
 * Deny every renderer-created navigation. Allowlisted window URLs may still
 * open in the user's browser; frame navigation may only stay on VRX's entry.
 */
export function installNavigationGuards({
  webContents,
  rendererEntry,
  isAllowedUrl,
  openExternal,
  warn
}: NavigationGuardOptions): void {
  webContents.setWindowOpenHandler((details) => {
    if (isAllowedUrl(details.url)) {
      openExternal(details.url).catch(() => {
        warn('openExternal failed', { scheme: '[unknown]', host: '[unknown]' })
      })
    } else {
      warn('navigation blocked', navigationMetadata(details.url))
    }
    return { action: 'deny' }
  })

  const entryUrl = new URL(rendererEntry)
  const entryOrigin = entryUrl.origin
  webContents.on('will-frame-navigate', (event) => {
    try {
      const url = new URL(event.url)
      const isOwnEntry =
        entryUrl.protocol === 'file:' ? url.href === entryUrl.href : url.origin === entryOrigin
      if (isOwnEntry) return
    } catch {
      // Invalid URLs are navigation attempts outside the known entry boundary.
    }

    event.preventDefault()
    warn('navigation blocked', navigationMetadata(event.url))
  })
}
