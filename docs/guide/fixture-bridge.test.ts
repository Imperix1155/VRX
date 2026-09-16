import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createFixtureBridge, installFixtureBridge } from './fixture-bridge'

describe('design guide account isolation', () => {
  it('refuses to replace an existing bridge and seals its own fake bridge', () => {
    const existing = createFixtureBridge('idle')
    const appWindow = { vrx: existing } as Window
    expect(() => installFixtureBridge(appWindow, 'available')).toThrow('existing app bridge')
    expect(appWindow.vrx).toBe(existing)
    const preview = {} as Window
    installFixtureBridge(preview, 'available')
    expect(Object.getOwnPropertyDescriptor(preview, 'vrx')).toMatchObject({
      writable: false,
      configurable: false
    })
    expect(Object.isFrozen(preview.vrx)).toBe(true)
  })

  it('account, game, URL and update actions stay local and launches fail closed', async () => {
    const fetch = vi.fn(() => {
      throw new Error('External request attempted')
    })
    vi.stubGlobal('fetch', fetch)
    try {
      const bridge = createFixtureBridge('available')
      expect(
        await bridge.login({
          platform: 'vrchat',
          credentials: { username: 'fixture', password: 'synthetic-example' }
        })
      ).toMatchObject({ ok: false })
      expect(
        await bridge.joinExploreRoom({
          platform: 'vrchat',
          selectionRef: 'synthetic',
          mode: 'desktop'
        })
      ).toMatchObject({ ok: false })
      expect(
        await bridge.joinInstance({
          platform: 'vrchat',
          friendId: 'synthetic',
          mode: 'desktop',
          expectedTarget: { worldId: 'synthetic', instanceId: 'synthetic' }
        })
      ).toMatchObject({ ok: false })
      expect(await bridge.selfInvite({ platform: 'vrchat', friendId: 'synthetic' })).toMatchObject({
        ok: false
      })
      await bridge.openUrl({ url: 'https://example.invalid' })
      await bridge.checkForUpdates()
      await bridge.downloadUpdate()
      await bridge.installUpdate()
      expect(fetch).not.toHaveBeenCalled()
      expect(await bridge.getAvatar('https://example.invalid/private-image')).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('note edits persist only within one fixture bridge', async () => {
    const first = createFixtureBridge('idle')
    const key = { platform: 'vrchat' as const, friendId: 'fixture' }
    const baseline = await first.getFriendNote(key)
    if (!baseline.revision) throw new Error('Fixture requires account revision')
    await first.setFriendNote({
      ...key,
      note: 'changed synthetic note',
      revision: baseline.revision
    })
    expect((await first.getFriendNote(key)).note).toBe('changed synthetic note')
    expect((await createFixtureBridge('idle').getFriendNote(key)).note).toBe(baseline.note)
  })

  it('excludes guide runtime and output from application packages', () => {
    const builder = readFileSync('electron-builder.yml', 'utf8')
    for (const path of [
      'docs/guide/**',
      'docs/design.html',
      'docs/glass.html',
      'dist/design-guide/**'
    ]) {
      expect(builder).toContain(`'!${path}'`)
    }
    const entry = readFileSync('src/renderer/src/main.tsx', 'utf8')
    expect(entry).not.toContain('docs/guide')
  })
})
