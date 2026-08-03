import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The main process is split (VRX-230): index.ts is the thin single-instance
// entry; app.ts is the full bootstrap it dynamic-imports while holding the lock.
const source = readFileSync(fileURLToPath(new URL('./app.ts', import.meta.url)), 'utf8')
const entrySource = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')

describe('main native notification wiring', () => {
  it('includes the packaged app icon on native notifications (VRX-82)', () => {
    expect(source).toContain('new NativeNotification({ title, body, icon })')
  })

  it('pins the VRX-204 Title Case toast headers (owner: headers capitalize every word)', () => {
    expect(source).toContain("title = 'Friend Online'")
    expect(source).toContain("title = 'Friend Joined a World'")
    expect(source).toContain("title = 'Friend Offline'")
    expect(source).toContain("title = 'Friends Gathering'")
  })

  it('pins the VRX-204 body templates + the load-bearing in-game label strip', () => {
    expect(source).toContain('`${alert.displayName} came online`')
    expect(source).toContain('`${alert.displayName} joined ${worldName}`')
    expect(source).toContain('`${alert.displayName} joined a world`')
    expect(source).toContain('`${alert.displayName} went offline`')
    // The wire instance label must never reach alert copy (VRX-85 review finding):
    // both world-bearing paths strip it before templating.
    expect(
      (source.match(/alert\.worldName\?\.replace\(INSTANCE_LABEL_SUFFIX, ''\)/g) ?? []).length
    ).toBe(2)
  })

  it('keeps the owner-authored hot-instance same-instance copy, plural-correct (VRX-237)', () => {
    // Singular/plural arms (a threshold of 1 must never read "1 friends…").
    expect(source).toContain("'1 friend is'")
    expect(source).toContain('`${alert.friendCount} friends are`')
    expect(source).toContain('`${countCopy} in the same instance — join them?`')
    expect(source).toContain('`${countCopy} together in ${strippedWorldName} — join them?`')
    // The false same-WORLD signal is gone for good.
    expect(source).not.toContain('same world')
  })

  it('keeps cold/GC Windows activations focused without treating every activation as a click', () => {
    expect(source).toContain('NativeNotification.handleActivation(focusMainWindow)')
    expect(source).not.toContain('NativeNotification.handleActivation(focusDashboard)')
  })

  it('queues a dashboard click until the recreated renderer finishes loading', () => {
    expect(source).toContain(
      'dashboardNavigation.request(window, rendererReadyWindows.has(window))'
    )
    expect(source).toContain("mainWindow.webContents.on('did-finish-load'")
    expect(source).toContain('dashboardNavigation.rendererReady(mainWindow)')
  })
})

describe('main single-instance lock (VRX-230)', () => {
  it('entry takes the lock verdict and hard-exits the losing duplicate', () => {
    expect(entrySource).toContain('const hasSingleInstanceLock = app.requestSingleInstanceLock()')
    // app.exit(0), not app.quit(): immediate, and a duplicate that loaded
    // nothing has nothing to tear down.
    expect(entrySource).toContain('if (!hasSingleInstanceLock) {\n  app.exit(0)\n}')
  })

  it('entry loads the app chunk via dynamic import ONLY while holding the lock', () => {
    // The split is load-bearing: a static import would make every duplicate
    // evaluate the full app chunk (logger, safeStorage/keychain reads that pop
    // a macOS prompt, ws module init) before the lock verdict. Dynamic import
    // in the else-branch means a duplicate loads nothing at all.
    expect(entrySource).toContain("import('./app')")
    expect(entrySource).not.toMatch(/^import .*'\.\/app'/m)
    const exitBranch = entrySource.indexOf('app.exit(0)')
    const load = entrySource.indexOf("import('./app')")
    expect(exitBranch).toBeGreaterThan(-1)
    expect(exitBranch).toBeLessThan(load)
  })

  it('entry imports nothing but electron itself', () => {
    // Any other static import would run its module-scope side effects in every
    // duplicate before the verdict — the entry stays electron-only.
    const staticImports = entrySource.match(/^import .*$/gm) ?? []
    expect(staticImports).toEqual(["import { app, dialog } from 'electron'"])
  })

  it('app chunk foregrounds the surviving window on second-instance', () => {
    expect(source).toContain("app.on('second-instance'")
    // Reuses focusMainWindow (restore → show → focus), guarded for early boot
    // where no window exists yet and BrowserWindow creation would throw.
    expect(source).toContain('if (app.isReady()) focusMainWindow()')
  })
})

describe('main navigation hardening', () => {
  it('fail-closes renderer frame navigation while preserving the entry origin', () => {
    expect(source).toContain("mainWindow.webContents.on('will-frame-navigate'")
    expect(source).toContain('event.preventDefault()')
    expect(source).toContain("entryUrl.protocol === 'file:'")
    expect(source).toContain('url.href === entryUrl.href')
    expect(source).toContain('url.origin === entryOrigin')
    expect(source).toContain('if (!isOwnEntry) event.preventDefault()')
  })

  it('opens only allowlisted window URLs externally and always denies the new window (VRX-33)', () => {
    // Keep this line-anchored: a bare substring would still pass if the
    // handler, gate, or denial line were commented out (VRX-243 lesson).
    const handler = source.match(
      /^\s*mainWindow\.webContents\.setWindowOpenHandler\(\(details\) => \{\n([\s\S]*?)^\s*}\)\n\n\s*const rendererPath/m
    )?.[1]

    expect(handler).toBeDefined()
    expect(handler).toMatch(/^\s*if \(isAllowedUrl\(details\.url\)\) \{$/m)

    const [allowedBranch, disallowedBranch] = handler!.split(/^\s*} else \{$/m)
    expect(allowedBranch).toMatch(/^\s*shell\.openExternal\(details\.url\)\.catch\(/m)
    expect(disallowedBranch).not.toMatch(/^\s*shell\.openExternal\(details\.url\)/m)
    expect(handler).toMatch(/^\s*return \{ action: 'deny' \}$/m)
  })
})

describe('main location authority event ordering', () => {
  it('consumes live deltas before alert and renderer fan-out', () => {
    const authority = source.indexOf('locationAuthority.consume(event)')
    const alerts = source.indexOf('friendAlerts.consume(event)')
    const renderer = source.indexOf('broadcast(event)', authority)
    expect(authority).toBeGreaterThan(-1)
    expect(authority).toBeLessThan(alerts)
    expect(authority).toBeLessThan(renderer)
  })
})

describe('main account-registry adoption', () => {
  it('passes the authenticated status identity and captured session epoch', () => {
    expect(source).toContain('const resolution = accountSession.resolve(status.platform)')
    expect(source).toContain('status.accountId !== null')
    expect(source).toMatch(
      /accountRegistry\.recordAuthenticated\(\s*status\.platform,\s*status\.accountId,\s*resolution\.epoch,\s*status\.displayName\s*\)/
    )
  })
})

describe('main identity-boundary fan-out', () => {
  it.each(['vrchat', 'chilloutvr'] as const)(
    'broadcasts the %s boundary only to non-destroyed windows',
    (platform) => {
      const resetCall = `resetPlatform('${platform}')`
      const resetIndex = source.indexOf(resetCall)
      const boundaryStart = source.lastIndexOf('onSessionBoundary:', resetIndex)
      const boundaryEnd = source.indexOf('\n      }', resetIndex)
      const boundary = source.slice(boundaryStart, boundaryEnd)

      expect(boundary).toContain('BrowserWindow.getAllWindows()')
      expect(boundary).toContain('if (!window.isDestroyed())')
      expect(boundary).toContain(
        `window.webContents.send('identity-boundary', { platform: '${platform}' })`
      )
    }
  )
})

describe('main credential-owner wiring', () => {
  it.each([
    ['vrchat', 'VRCHAT_PRIMARY'],
    ['chilloutvr', 'CHILLOUTVR_PRIMARY']
  ])('records the %s owner only inside the successful credential-save closure', (platform, key) => {
    expect(source).toMatch(
      new RegExp(
        `save: \\(.*accountId\\) => \\{\\s*saveCredential\\(CREDENTIAL_KEYS\\.${key},[\\s\\S]*?\\)\\s*if \\(accountId !== null\\) \\{\\s*recordCredentialOwner\\(CREDENTIAL_KEYS\\.${key}, accountId\\)`
      )
    )
    expect(source).toMatch(
      new RegExp(
        `onIdentity: \\(accountId\\) => \\{\\s*accountSession\\.setIdentity\\('${platform}', accountId\\)\\s*\\}`
      )
    )
  })
})

describe('main window minimum size (VRX-243)', () => {
  it('pins minWidth/minHeight to the shipped default so the window can never shrink below it', () => {
    // DESIGN.md §8's no-scroll rule (control surfaces don't scroll) had no
    // mechanical guard: a user-shrunk window could squeeze Settings below the
    // height its tallest category (Behavior, 5 rows) needs, forcing a scrollbar.
    // The floor is pinned to the app's own already-shipped default (900x670),
    // clamped to the display work area so small/scaled screens keep a usable
    // window. Line-anchored regexes (review F1, mutation-proven): a bare
    // substring match stays green when the lines are commented out.
    expect(source).toContain('width: 900,\n    height: 670,')
    expect(source).toMatch(/^\s*minWidth: Math\.min\(900, workAreaSize\.width\),\s*$/m)
    expect(source).toMatch(/^\s*minHeight: Math\.min\(670, workAreaSize\.height\),\s*$/m)
  })
})
