import { is } from '@electron-toolkit/utils'
import type { WebFrameMain } from 'electron'

/**
 * Guard every ipcMain.handle() against spoofed senders. In dev, the renderer
 * loads from the Vite dev server; in prod, from a local file:// URL — both are
 * controlled origins that could never come from a remote attacker on a desktop app.
 * Call this at the top of every handler and throw if it returns false.
 */
export function isTrustedIpcSender(frame: WebFrameMain | null): boolean {
  if (!frame) return false
  const { url } = frame
  if (is.dev) {
    const rendererUrl = process.env['ELECTRON_RENDERER_URL'] ?? ''
    return rendererUrl.length > 0 && url.startsWith(rendererUrl)
  }
  return url.startsWith('file://')
}
