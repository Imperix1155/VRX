import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { GameFavoritesService } from '../services/gameFavorites'
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

import { registerGameFavoritesHandlers } from './gameFavorites'

const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent
const revision = { platformAccountId: 'usr_me', epoch: 1 }
const evidence = {
  platform: 'vrchat' as const,
  worldId: 'wrld_a',
  name: 'A',
  thumbnailUrl: null,
  activity: { state: 'unknown' as const, value: null, source: 'unknown' as const },
  visibleRoomCount: { state: 'unknown' as const, value: null, source: 'unknown' as const },
  popularity: null,
  sourceOrder: 0
}

describe('game favorites handlers', () => {
  const service = {
    get: vi.fn(async () => ({
      state: 'ready',
      revision,
      view: {
        oneGroupPerItem: true,
        groups: { friend: [], world: [] },
        friends: {},
        worlds: { wrld_a: ['world:worlds1'] },
        worldEvidence: [evidence]
      }
    })),
    set: vi.fn(async () => ({ ok: true, groups: [] }))
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
    for (const fn of [...Object.values(service), ...Object.values(explore)]) fn.mockClear()
    registerGameFavoritesHandlers(
      service as unknown as GameFavoritesService,
      explore as unknown as FavoriteWorldsExplore
    )
  })

  it('rejects an untrusted sender before reading or writing', async () => {
    trusted.value = false
    await expect(
      Promise.resolve().then(() =>
        handlers.get('get-game-favorites')!(event, { platform: 'vrchat' })
      )
    ).rejects.toThrow('Untrusted IPC sender')
    expect(() => handlers.get('set-game-favorite')!(event, {})).toThrow('Untrusted IPC sender')
    expect(service.get).not.toHaveBeenCalled()
    expect(service.set).not.toHaveBeenCalled()
  })

  it('hands favorite worlds out as Explore references, never raw ids alone', async () => {
    const result = await handlers.get('get-game-favorites')!(event, {
      platform: 'vrchat',
      refresh: true
    })
    expect(service.get).toHaveBeenCalledWith('vrchat', true)
    expect(result).toMatchObject({
      state: 'ready',
      revision,
      favorites: { worlds: { wrld_a: ['world:worlds1'] }, worldList: [{ worldRef: 'ref-wrld_a' }] }
    })
    expect(result).not.toHaveProperty('view')
  })

  it('names a world by its reference and refuses an expired one', async () => {
    await handlers.get('set-game-favorite')!(event, {
      platform: 'vrchat',
      kind: 'world',
      worldRef: 'ref-a',
      groupKey: 'world:worlds1',
      on: true,
      revision
    })
    expect(service.set).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'world', id: 'wrld_a', world: evidence })
    )
    expect(
      await handlers.get('set-game-favorite')!(event, {
        platform: 'vrchat',
        kind: 'world',
        worldRef: 'ref-gone',
        groupKey: 'world:worlds1',
        on: true,
        revision
      })
    ).toEqual({ ok: false, reason: 'stale' })
  })

  it('refuses a malformed request without writing', async () => {
    for (const bad of [
      { platform: 'vrchat', kind: 'world', worldId: 'wrld_a', groupKey: 'x', on: true, revision },
      { platform: 'steam', kind: 'friend', friendId: 'u', groupKey: 'x', on: true, revision },
      { platform: 'vrchat', kind: 'friend', friendId: 'u', groupKey: '', on: true, revision },
      {
        platform: 'vrchat',
        kind: 'friend',
        friendId: 'u',
        groupKey: 'x',
        on: true,
        revision,
        extra: 1
      }
    ]) {
      expect(await handlers.get('set-game-favorite')!(event, bad)).toEqual({
        ok: false,
        reason: 'invalid'
      })
    }
    expect(service.set).not.toHaveBeenCalled()
  })
})
