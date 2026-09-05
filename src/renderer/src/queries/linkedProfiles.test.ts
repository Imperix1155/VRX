// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import {
  fetchLinkedProfiles,
  changeLinkedProfile,
  linkedProfilesKey,
  subscribeLinkedProfiles
} from './linkedProfiles'

afterEach(() => vi.unstubAllGlobals())
describe('linked profile snapshots', () => {
  it('fails safely without a bridge', async () => {
    vi.stubGlobal('window', {})
    await expect(fetchLinkedProfiles()).rejects.toThrow('unavailable')
  })
  it('returns typed storage failures without retrying the write', async () => {
    const change = vi.fn().mockResolvedValue({ ok: false, reason: 'storage' })
    vi.stubGlobal('window', { vrx: { changeLinkedProfile: change } })
    const client = new QueryClient()
    client.setQueryData(linkedProfilesKey, { profiles: [], lease: 'lease' })
    expect(
      await changeLinkedProfile(client, 'lease', {
        kind: 'unlink',
        personId: 'person',
        expectedRevision: 1
      })
    ).toEqual({ ok: false, reason: 'storage' })
    expect(change).toHaveBeenCalledTimes(1)
  })
  it('clears mounted data at an identity boundary and rejects an old write result', async () => {
    let boundary = (): void => {}
    let finish!: (value: unknown) => void
    vi.stubGlobal('window', {
      vrx: {
        onIdentityBoundary: (fn: () => void) => {
          boundary = fn
          return () => {}
        },
        onLinkedProfilesChanged: () => () => {},
        changeLinkedProfile: () =>
          new Promise((resolve) => {
            finish = resolve
          })
      }
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(linkedProfilesKey, { profiles: [], lease: 'old' })
    const dispose = subscribeLinkedProfiles(client)
    const pending = changeLinkedProfile(client, 'old', {
      kind: 'unlink',
      personId: 'person',
      expectedRevision: 1
    })
    boundary()
    finish({ ok: true, value: { profiles: [{ id: 'private-old-person' }], lease: 'old' } })
    expect(await pending).toEqual({ ok: false, reason: 'stale' })
    expect(client.getQueryData(linkedProfilesKey)).toEqual({ profiles: [], lease: '' })
    dispose()
  })
})
