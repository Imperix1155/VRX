import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')

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

  it('keeps the owner-authored hot-instance world and worldless copy (VRX-85)', () => {
    expect(source).toContain(
      '`${alert.friendCount} friends are in ${strippedWorldName} — join them?`'
    )
    expect(source).toContain('`${alert.friendCount} friends are in the same world — join them?`')
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

describe('main navigation hardening', () => {
  it('fail-closes renderer frame navigation while preserving the entry origin', () => {
    expect(source).toContain("mainWindow.webContents.on('will-frame-navigate'")
    expect(source).toContain('event.preventDefault()')
    expect(source).toContain("entryUrl.protocol === 'file:'")
    expect(source).toContain('url.href === entryUrl.href')
    expect(source).toContain('url.origin === entryOrigin')
    expect(source).toContain('if (!isOwnEntry) event.preventDefault()')
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
