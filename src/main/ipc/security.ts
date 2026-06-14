import { is } from '@electron-toolkit/utils'
import type { WebFrameMain } from 'electron'

/**
 * Guard every ipcMain.handle() against spoofed senders.
 * - Dev: exact origin match against the Vite dev server URL (avoids startsWith
 *   prefix ambiguity, e.g. localhost:5173.evil).
 * - Prod: top-level file:// frame only (no subframes — prevents a rogue local
 *   file embedded in a webview from passing the check).
 */
export function isTrustedIpcSender(frame: WebFrameMain | null): boolean {
  if (!frame) return false
  const { url } = frame
  if (is.dev) {
    const rendererUrl = process.env['ELECTRON_RENDERER_URL'] ?? ''
    if (!rendererUrl) return false
    try {
      return new URL(url).origin === new URL(rendererUrl).origin
    } catch {
      return false
    }
  }
  // In prod, only trust a top-level file:// frame (parent === null means top frame).
  return url.startsWith('file://') && frame.parent === null
}
