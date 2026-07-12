import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountSession } from './accountSession'
import {
  FAVORITES_MAX,
  HISTORY_RING_CAPACITY,
  NOTES_MAX,
  SOCIAL_STORE_FORMAT_VERSION,
  SocialStore,
  type SocialStoreFile,
  type SocialStoreStorage
} from './socialStore'

vi.mock('electron-store', () => ({ default: class {} }))

class MemorySocialStorage implements SocialStoreStorage {
  value: unknown = undefined
  writes: SocialStoreFile[] = []

  read(): unknown {
    return this.value
  }

  write(value: SocialStoreFile): void {
    this.value = structuredClone(value)
    this.writes.push(structuredClone(value))
  }
}

describe('SocialStore', () => {
  let session: AccountSession
  let storage: MemorySocialStorage
  let store: SocialStore

  beforeEach(() => {
    session = new AccountSession()
    storage = new MemorySocialStorage()
    store = new SocialStore(session, storage)
    session.setIdentity('vrchat', 'usr_a')
  })

  const currentEpoch = (): number => {
    const resolution = session.resolve('vrchat')
    if ('status' in resolution) throw new Error('test identity did not resolve')
    return resolution.epoch
  }

  it('writes and reads a versioned AccountScoped namespace by canonical account key', () => {
    store.write(
      { platform: 'vrchat', platformAccountId: 'usr_a', epoch: currentEpoch() },
      'favorites',
      { friend_a: true }
    )

    expect(store.read('vrchat', 'usr_a', 'favorites')).toEqual({
      schemaVersion: 1,
      platform: 'vrchat',
      platformAccountId: 'usr_a',
      data: { friend_a: true }
    })
    expect(storage.writes.at(-1)).toMatchObject({
      storeFormatVersion: SOCIAL_STORE_FORMAT_VERSION,
      accounts: { 'vrchat:usr_a': expect.any(Object) }
    })
  })

  it('rejects a stale write issued before an account switch', () => {
    const staleEpoch = currentEpoch()
    session.setIdentity('vrchat', null)
    session.setIdentity('vrchat', 'usr_b')

    expect(() =>
      store.write(
        { platform: 'vrchat', platformAccountId: 'usr_a', epoch: staleEpoch },
        'favorites',
        { friend_a: true }
      )
    ).toThrow('stale account epoch')
    expect(storage.writes).toHaveLength(0)
  })

  it('rejects a stale write issued before a same-account relogin', () => {
    const staleEpoch = currentEpoch()
    session.setIdentity('vrchat', null)
    session.setIdentity('vrchat', 'usr_a')

    expect(() =>
      store.write(
        { platform: 'vrchat', platformAccountId: 'usr_a', epoch: staleEpoch },
        'favorites',
        { friend_a: true }
      )
    ).toThrow('stale account epoch')
    expect(storage.writes).toHaveLength(0)
  })

  it.each(['account:id', 'account id', 'account\nid', ''])(
    'strictly rejects unsafe platform account ids (%j)',
    (platformAccountId) => {
      expect(() => store.read('vrchat', platformAccountId, 'favorites')).toThrow(
        'invalid platform account id'
      )
    }
  )

  it('enforces the favorites cardinality cap at runtime', () => {
    const favorites = Object.fromEntries(
      Array.from({ length: FAVORITES_MAX + 1 }, (_, index) => [`friend_${index}`, true as const])
    )

    expect(() =>
      store.write(
        { platform: 'vrchat', platformAccountId: 'usr_a', epoch: currentEpoch() },
        'favorites',
        favorites
      )
    ).toThrow('invalid favorites data')
  })

  it('enforces the notes cardinality cap at runtime', () => {
    const notes = Object.fromEntries(
      Array.from({ length: NOTES_MAX + 1 }, (_, index) => [`friend_${index}`, 'note'])
    )

    expect(() =>
      store.write(
        { platform: 'vrchat', platformAccountId: 'usr_a', epoch: currentEpoch() },
        'notes',
        notes
      )
    ).toThrow('invalid notes data')
  })

  it('runtime-validates tags, social preferences, and per-friend opt-outs', () => {
    const context = {
      platform: 'vrchat' as const,
      platformAccountId: 'usr_a',
      epoch: currentEpoch()
    }

    expect(() => store.write(context, 'tags', { friend_a: [''] })).toThrow('invalid tags data')
    expect(() =>
      store.write(context, 'socialPrefs', { notifyFriendOnline: 'yes' } as never)
    ).toThrow('invalid socialPrefs data')
    expect(() =>
      store.write(context, 'perFriendOptOuts', { friend_a: ['unknown'] } as never)
    ).toThrow('invalid perFriendOptOuts data')
  })

  it('refuses to overwrite a store written by a newer build', () => {
    storage.value = { storeFormatVersion: 999, accounts: {}, futureField: 'preserve' }
    store = new SocialStore(session, storage)

    expect(() =>
      store.write(
        { platform: 'vrchat', platformAccountId: 'usr_a', epoch: currentEpoch() },
        'favorites',
        {}
      )
    ).toThrow('refusing to overwrite social data written by a newer version')
    expect(storage.writes).toHaveLength(0)
  })

  it('preserves a newer format marker when its payload shape is incompatible', () => {
    storage.value = { storeFormatVersion: 999, accounts: [] }
    store = new SocialStore(session, storage)

    expect(() =>
      store.write(
        { platform: 'vrchat', platformAccountId: 'usr_a', epoch: currentEpoch() },
        'favorites',
        {}
      )
    ).toThrow('refusing to overwrite social data written by a newer version')
    expect(storage.writes).toHaveLength(0)
  })

  it('treats malformed persisted namespace data as absent', () => {
    storage.value = {
      storeFormatVersion: SOCIAL_STORE_FORMAT_VERSION,
      accounts: {
        'vrchat:usr_a': {
          favorites: {
            schemaVersion: 1,
            platform: 'vrchat',
            platformAccountId: 'usr_a',
            data: { friend_a: false }
          }
        }
      }
    }
    store = new SocialStore(session, storage)

    expect(store.read('vrchat', 'usr_a', 'favorites')).toBeNull()
  })

  it.each(['instanceHistory', 'activityHistory'] as const)(
    'refuses %s writes while exposing the bounded-ring contract',
    (namespace) => {
      expect(HISTORY_RING_CAPACITY).toBe(200)
      expect(() =>
        store.write(
          { platform: 'vrchat', platformAccountId: 'usr_a', epoch: currentEpoch() },
          namespace,
          { capacity: HISTORY_RING_CAPACITY, entries: [] }
        )
      ).toThrow('history writes are not supported')
    }
  )
})
