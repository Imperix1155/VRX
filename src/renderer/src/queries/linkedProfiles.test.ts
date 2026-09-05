// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { fullFriend } from '../test-utils/friendFixture'
import {
  fetchLinkedProfiles,
  changeLinkedProfile,
  linkedProfilesKey,
  subscribeLinkedProfiles,
  retainNewestLinkSnapshot
} from './linkedProfiles'

afterEach(() => vi.unstubAllGlobals())
describe('linked profile snapshots', () => {
  it('clears ownership at a boundary and cannot restore it from a late read', async () => {
    let boundary = (): void => {}
    let finish!: (value: unknown) => void
    const old = {
      profiles: [],
      lease: 'old',
      storeRevision: 1,
      accountIds: { vrchat: 'old-owner' }
    }
    vi.stubGlobal('window', {
      vrx: {
        onIdentityBoundary: (fn: () => void) => {
          boundary = fn
          return () => {}
        },
        getLinkedProfiles: () =>
          new Promise((resolve) => {
            finish = resolve
          })
      }
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(linkedProfilesKey, old)
    const dispose = subscribeLinkedProfiles(client)
    const read = client
      .fetchQuery({
        queryKey: linkedProfilesKey,
        queryFn: ({ signal }) => fetchLinkedProfiles(signal)
      })
      .catch(() => undefined)
    boundary()
    const cleared = { profiles: [], lease: '', storeRevision: 0, accountIds: {} }
    expect(client.getQueryData(linkedProfilesKey)).toEqual(cleared)
    finish({ ok: true, value: old })
    await read
    expect(client.getQueryData(linkedProfilesKey)).toEqual(cleared)
    dispose()
    client.clear()
  })
  it('refreshes fallback names after friend-name changes but not presence-only updates', () => {
    vi.stubGlobal('window', {})
    const client = new QueryClient()
    const friend = fullFriend('First name', 'vrchat')
    client.setQueryData(['friends', 'vrchat'], [friend])
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const dispose = subscribeLinkedProfiles(client)
    client.setQueryData(['friends', 'vrchat'], [{ ...friend, presence: { state: 'offline' } }])
    expect(invalidate).not.toHaveBeenCalled()
    client.setQueryData(['friends', 'vrchat'], [{ ...friend, displayName: 'Renamed' }])
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: linkedProfilesKey })
    client.setQueryData(
      ['friends', 'vrchat'],
      [{ ...friend, displayName: 'Renamed', status: 'busy' }]
    )
    expect(invalidate).toHaveBeenCalledTimes(1)
    dispose()
    client.clear()
  })
  it('does not let an earlier read roll back a committed mutation', async () => {
    let finish!: (value: unknown) => void
    const newer = { profiles: [], lease: 'lease', storeRevision: 2 }
    vi.stubGlobal('window', {
      vrx: {
        getLinkedProfiles: () =>
          new Promise((resolve) => {
            finish = resolve
          }),
        changeLinkedProfile: () => Promise.resolve({ ok: true, value: newer })
      }
    })
    const client = new QueryClient()
    const earlier = { ...newer, storeRevision: 1 }
    client.setQueryData(linkedProfilesKey, earlier)
    const read = client.fetchQuery({
      queryKey: linkedProfilesKey,
      queryFn: ({ signal }) => fetchLinkedProfiles(signal),
      structuralSharing: retainNewestLinkSnapshot
    })
    await changeLinkedProfile(client, 'lease', {
      kind: 'unlink',
      personId: 'p',
      expectedRevision: 1
    })
    finish({ ok: true, value: earlier })
    await read
    expect(client.getQueryData(linkedProfilesKey)).toEqual(newer)
  })
  it('does not publish an older mutation reply over a newer document', async () => {
    const replies: Array<(value: unknown) => void> = []
    vi.stubGlobal('window', {
      vrx: { changeLinkedProfile: () => new Promise((resolve) => replies.push(resolve)) }
    })
    const client = new QueryClient()
    client.setQueryData(linkedProfilesKey, { profiles: [], lease: 'lease', storeRevision: 1 })
    const change = { kind: 'unlink' as const, personId: 'person', expectedRevision: 1 }
    const earlier = changeLinkedProfile(client, 'lease', change)
    const later = changeLinkedProfile(client, 'lease', { ...change, personId: 'second' })
    const newest = { profiles: [], lease: 'lease', storeRevision: 3 }
    replies[1]!({ ok: true, value: newest })
    await later
    replies[0]!({ ok: true, value: { ...newest, storeRevision: 2 } })
    expect(await earlier).toEqual({ ok: true, value: newest })
    expect(client.getQueryData(linkedProfilesKey)).toEqual(newest)
  })
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
    client.setQueryData(linkedProfilesKey, {
      profiles: [],
      lease: 'old',
      accountIds: { vrchat: 'old-owner' }
    })
    const dispose = subscribeLinkedProfiles(client)
    const pending = changeLinkedProfile(client, 'old', {
      kind: 'unlink',
      personId: 'person',
      expectedRevision: 1
    })
    boundary()
    finish({
      ok: true,
      value: {
        profiles: [{ id: 'private-old-person' }],
        lease: 'old',
        accountIds: { vrchat: 'old-owner' }
      }
    })
    expect(await pending).toEqual({ ok: false, reason: 'stale' })
    expect(client.getQueryData(linkedProfilesKey)).toEqual({
      profiles: [],
      lease: '',
      storeRevision: 0,
      accountIds: {}
    })
    dispose()
  })
})
