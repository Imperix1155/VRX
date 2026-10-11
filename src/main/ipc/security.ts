import { is } from '@electron-toolkit/utils'
import { app, type WebFrameMain } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Guard every ipcMain.handle() against spoofed senders.
 * - Dev: exact origin match against the Vite dev server URL (avoids startsWith
 *   prefix ambiguity, e.g. localhost:5173.evil).
 * - Prod and built preview: only the app's own top-level renderer entry
 *   (`<appPath>/out/renderer/index.html`). Any other local file, and any
 *   subframe, is rejected even when it is a file:// document.
 */
export function isTrustedIpcSender(frame: WebFrameMain | null): boolean {
  if (!frame) return false
  if (is.dev) {
    const rendererUrl = process.env['ELECTRON_RENDERER_URL'] ?? ''
    if (!rendererUrl) return isRendererEntry(frame)
    try {
      return new URL(frame.url).origin === new URL(rendererUrl).origin
    } catch {
      return false
    }
  }
  return isRendererEntry(frame)
}

/** Decoded, separator-normalized file path of a file:// URL (case-folded on Windows). */
function normalizedFilePath(raw: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol !== 'file:' || parsed.host !== '') return null
  let path: string
  try {
    path = decodeURIComponent(parsed.pathname)
  } catch {
    return null
  }
  return process.platform === 'win32' ? path.toLowerCase() : path
}

/** The built renderer entry, loaded by createWindow via `../renderer/index.html`. */
function isRendererEntry(frame: WebFrameMain): boolean {
  if (frame.parent !== null) return false
  const sender = normalizedFilePath(frame.url)
  const entry = normalizedFilePath(
    pathToFileURL(join(app.getAppPath(), 'out/renderer/index.html')).href
  )
  return sender !== null && sender === entry
}
