import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { Favorites } from '../services/favorites'
import type { FavoriteWorldsExplore } from './favorites'

const handlers = new Map<string, (event: unknown, req: unknown) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, req: unknown) => unknown) => {
      handlers.set(channel, fn)
    })
  }
}))

const trusted = vi.hoisted(() => ({ value: true }))
vi.mock('./security', () => ({ isTrustedIpcSender: vi.fn(() => trusted.value) }))

import { registerFavoritesHandlers } from './favorites'

const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent
const revision = { platformAccountId: 'usr_me', epoch: 1 }
const evidence = {
  platform: 'vrchat' as const,
  worldId: 'wrld_a',
  name: 'A',
  thumbnailUrl: 'https://files.example/a.png',
  activity: { state: 'complete' as const, value: 4, source: 'vrc-world-occupants' as const },
  visibleRoomCount: { state: 'unknown' as const, value: null, source: 'unknown' as const },
  popularity: 1,
  sourceOrder: 0
}

describe('favorites handlers', () => {
  const favorites = {
    listFriends: vi.fn(() => ({ friendIds: ['usr_a'], revision })),
    setFriends: vi.fn(() => ({ ok: true })),
    listWorlds: vi.fn(() => ({
      worlds: [{ worldId: 'wrld_a', name: 'A', thumbnailUrl: null, addedAt: 5 }],
      revision
    })),
    addWorld: vi.fn(() => ({ ok: true })),
    removeWorld: vi.fn(() => ({ ok: true }))
  }
  const explore = {
    adoptWorlds: vi.fn((_platform: string, items: readonly { worldId: string }[]) =>
      items.map((item) => ({ ...item, worldRef: `ref-${item.worldId}` }))
    ),
    worldEvidence: vi.fn((_platform: string, ref: string) => (ref === 'ref-a' ? evidence : null))
  }

  beforeEach(() => {
    handlers.clear()
    trusted.value = true
    for (const fn of [...Object.values(favorites), ...Object.values(explore)]) fn.mockClear()
    registerFavoritesHandlers(
      favorites as unknown as Favorites,
      explore as unknown as FavoriteWorldsExplore
    )
  })

  it('rejects an untrusted sender before reading or writing', () => {
    trusted.value = false
    for (const channel of [
      'get-favorite-friends',
      'set-favorite-friend',
      'get-favorite-worlds',
      'set-favorite-world'
    ]) {
      expect(() => handlers.get(channel)!(event, { platform: 'vrchat' })).toThrow(
        'Untrusted IPC sender'
      )
    }
    expect(favorites.listFriends).not.toHaveBeenCalled()
    expect(favorites.addWorld).not.toHaveBeenCalled()
  })

  it('rejects unknown platforms and malformed writes', () => {
    expect(() => handlers.get('get-favorite-friends')!(event, { platform: 'steam' })).toThrow()
    expect(() => handlers.get('get-favorite-worlds')!(event, null)).toThrow()
    expect(handlers.get('set-favorite-friend')!(event, { platform: 'vrchat' })).toEqual({
      ok: false,
      reason: 'invalid'
    })
    // A star names a reference, never a picture address.
    expect(
      handlers.get('set-favorite-world')!(event, {
        platform: 'vrchat',
        favorite: true,
        worldRef: 'ref-a',
        thumbnailUrl: 'https://evil.example/x.png',
        revision
      })
    ).toEqual({ ok: false, reason: 'invalid' })
    expect(favorites.setFriends).not.toHaveBeenCalled()
    expect(favorites.addWorld).not.toHaveBeenCalled()
  })

  it('passes friend stars through', () => {
    expect(handlers.get('get-favorite-friends')!(event, { platform: 'chilloutvr' })).toEqual({
      friendIds: ['usr_a'],
      revision
    })
    handlers.get('set-favorite-friend')!(event, {
      platform: 'vrchat',
      friendIds: ['usr_a'],
      favorite: true,
      revision
    })
    expect(favorites.setFriends).toHaveBeenCalledWith('vrchat', ['usr_a'], true, revision)
  })

  it('lists favorite worlds as Explore worlds with unknown counts', () => {
    const result = handlers.get('get-favorite-worlds')!(event, { platform: 'vrchat' }) as {
      worlds: { worldRef: string; activity: { state: string } }[]
    }
    expect(result.worlds[0]).toMatchObject({
      worldId: 'wrld_a',
      worldRef: 'ref-wrld_a',
      activity: { state: 'unknown' }
    })
    favorites.listWorlds.mockReturnValueOnce({ worlds: [] } as never)
    expect(handlers.get('get-favorite-worlds')!(event, { platform: 'vrchat' })).toEqual({
      worlds: []
    })
  })

  it('stars a world from main’s own record and unstars by id', () => {
    expect(
      handlers.get('set-favorite-world')!(event, {
        platform: 'vrchat',
        favorite: true,
        worldRef: 'ref-a',
        revision
      })
    ).toEqual({ ok: true })
    expect(favorites.addWorld).toHaveBeenCalledWith(
      'vrchat',
      { worldId: 'wrld_a', name: 'A', thumbnailUrl: 'https://files.example/a.png' },
      revision
    )
    expect(
      handlers.get('set-favorite-world')!(event, {
        platform: 'vrchat',
        favorite: true,
        worldRef: 'expired',
        revision
      })
    ).toEqual({ ok: false, reason: 'stale' })
    handlers.get('set-favorite-world')!(event, {
      platform: 'vrchat',
      favorite: false,
      worldId: 'wrld_a',
      revision
    })
    expect(favorites.removeWorld).toHaveBeenCalledWith('vrchat', 'wrld_a', revision)
  })
})
