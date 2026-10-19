// Renderer CSP is `style-src 'self'` (no 'unsafe-inline', AGENTS.md / #369).
// That holds for production builds: CSS ships as files and React applies
// `style={}` through the CSSOM, which CSP does not govern.
//
// The Vite DEV server is different: it injects CSS as <style> elements for
// HMR, which `style-src 'self'` blocks. This plugin relaxes style-src for
// `electron-vite dev` only (apply: 'serve'), so packaged builds never carry it.

import type { Plugin } from 'vite'

const STRICT_STYLE_SRC = "style-src 'self';"
const DEV_STYLE_SRC = "style-src 'self' 'unsafe-inline';"

/** Rewrite the renderer CSP's style-src for the dev server; throws on drift. */
export function relaxStyleCspForDev(html: string): string {
  if (!html.includes(STRICT_STYLE_SRC)) {
    throw new Error(`dev-style-csp: renderer CSP no longer contains "${STRICT_STYLE_SRC}"`)
  }
  return html.replace(STRICT_STYLE_SRC, DEV_STYLE_SRC)
}

/** Vite plugin: dev-server only; never part of a production build. */
export function devStyleCspPlugin(): Plugin {
  return {
    name: 'vrx-dev-style-csp',
    apply: 'serve',
    transformIndexHtml: { order: 'pre', handler: relaxStyleCspForDev }
  }
}
