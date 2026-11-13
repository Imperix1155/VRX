// Starts the built VRX app for an end-to-end test and hands back Playwright's
// handles for it. Run `npm run build` first: the tests drive `out/`, the same
// files a release packages.
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')

/** Proxy settings would send requests around the redirect; the tests use none. */
const PROXY_VARIABLES = /^(?:https?|all|no)_proxy$/i

/**
 * Launch VRX against the fake platforms on `fakePort`.
 *
 * Every launch gets a fresh, empty profile folder (settings, sign-ins, cache),
 * deleted again by `close()`. Pass the `userData` of an earlier launch to start
 * the app a second time with what that run saved, and `keepUserData: true` on
 * the first launch so its `close()` leaves the folder in place.
 */
export async function launchVrx({
  fakePort,
  locale = 'en-US',
  userData = mkdtempSync(join(tmpdir(), 'vrx-e2e-')),
  keepUserData = false
}) {
  if (!existsSync(join(root, 'out', 'main', 'index.js'))) {
    throw new Error('e2e: out/ is missing. Run `npm run build` before `npm run test:e2e`.')
  }
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !PROXY_VARIABLES.test(name))
  )
  env.VRX_E2E_FAKE_PORT = String(fakePort)
  env.ELECTRON_DISABLE_SECURITY_WARNINGS = '1'

  const app = await _electron.launch({
    // In Node, the `electron` package resolves to the path of its binary.
    executablePath: require('electron'),
    args: [
      '-r',
      join(root, 'e2e', 'redirect.cjs'),
      root,
      `--user-data-dir=${userData}`,
      `--lang=${locale}`,
      // A Linux CI runner (and a container running as root) cannot start
      // Chromium's operating-system sandbox. The window's own `sandbox: true`
      // setting still applies. Windows and macOS run with the sandbox on.
      ...(process.platform === 'linux' ? ['--no-sandbox'] : [])
    ],
    cwd: root,
    env,
    timeout: 60_000
  })

  /** Problems the renderer reported: uncaught errors and `console.error`. */
  const rendererErrors = []
  const page = await app.firstWindow()
  page.on('pageerror', (error) => rendererErrors.push(`uncaught: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') rendererErrors.push(`console.error: ${message.text()}`)
  })
  // 900x670 is the smallest window VRX supports; everything must work there.
  await page.setViewportSize({ width: 900, height: 670 })

  return {
    app,
    page,
    userData,
    rendererErrors,
    async close() {
      await app.close().catch(() => undefined)
      if (!keepUserData) rmSync(userData, { recursive: true, force: true })
    }
  }
}

/** Remove a profile folder kept with `keepUserData`. */
export function removeUserData(userData) {
  rmSync(userData, { recursive: true, force: true })
}
