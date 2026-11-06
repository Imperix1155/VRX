import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FAVORITE_WORLDS_MAX } from '@shared/favorites'
import { AccountSession } from './accountSession'
import { SocialStore, type SocialStoreStorage } from './socialStore'
import { Favorites } from './favorites'

vi.mock('electron-store', () => ({ default: class {} }))

class MemorySocialStorage implements SocialStoreStorage {
  value: unknown = {}
  writes = 0

  read(): unknown {
    return this.value
  }

  write(value: unknown): void {
    this.value = structuredClone(value)
    this.writes += 1
  }
}

const world = (
  n: number,
  name = `World ${n}`
): { worldId: string; name: string; thumbnailUrl: string } => ({
  worldId: `wrld_${String(n).padStart(4, '0')}`,
  name,
  thumbnailUrl: `https://files.example/${n}.png`
})

describe('Favorites', () => {
  let accountSession: AccountSession
  let storage: MemorySocialStorage
  let socialStore: SocialStore
  let now: number
  let favorites: Favorites

  beforeEach(() => {
    accountSession = new AccountSession()
    storage = new MemorySocialStorage()
    socialStore = new SocialStore(accountSession, storage)
    now = 1_000
    favorites = new Favorites(accountSession, socialStore, () => now)
  })

  it('has nothing and no revision while signed out, and refuses a write', () => {
    const revision = { platformAccountId: 'usr_me', epoch: 1 }
    expect(favorites.listFriends('vrchat')).toEqual({ friendIds: [] })
    expect(favorites.listWorlds('vrchat')).toEqual({ worlds: [] })
    expect(favorites.setFriends('vrchat', ['usr_a'], true, revision)).toEqual({
      ok: false,
      reason: 'not-authenticated'
    })
    expect(favorites.addWorld('vrchat', world(1), revision)).toEqual({
      ok: false,
      reason: 'not-authenticated'
    })
    expect(storage.writes).toBe(0)
  })

  it('stars and unstars friends per account and platform', () => {
    accountSession.setIdentity('vrchat', 'usr_me')
    accountSession.setIdentity('chilloutvr', 'cvr-me')
    const vrc = favorites.listFriends('vrchat').revision
    const cvr = favorites.listFriends('chilloutvr').revision

    expect(favorites.setFriends('vrchat', ['usr_a', 'usr_b'], true, vrc)).toEqual({ ok: true })
    expect(favorites.setFriends('chilloutvr', ['cvr-a'], true, cvr)).toEqual({ ok: true })
    expect(favorites.listFriends('vrchat').friendIds.sort()).toEqual(['usr_a', 'usr_b'])
    expect(favorites.listFriends('chilloutvr').friendIds).toEqual(['cvr-a'])

    expect(favorites.setFriends('vrchat', ['usr_a'], false, vrc)).toEqual({ ok: true })
    expect(favorites.listFriends('vrchat').friendIds).toEqual(['usr_b'])

    // A fresh service reads what was saved.
    const reread = new Favorites(accountSession, new SocialStore(accountSession, storage))
    expect(reread.listFriends('vrchat').friendIds).toEqual(['usr_b'])

    // Another account on the same platform starts empty.
    accountSession.setIdentity('vrchat', 'usr_other')
    expect(favorites.listFriends('vrchat').friendIds).toEqual([])
  })

  it('does not rewrite the file for an unchanged star', () => {
    accountSession.setIdentity('vrchat', 'usr_me')
    const revision = favorites.listFriends('vrchat').revision
    favorites.setFriends('vrchat', ['usr_a'], true, revision)
    const writes = storage.writes
    expect(favorites.setFriends('vrchat', ['usr_a'], true, revision)).toEqual({ ok: true })
    expect(favorites.setFriends('vrchat', ['usr_z'], false, revision)).toEqual({ ok: true })
    expect(storage.writes).toBe(writes)
  })

  it('refuses bad ids, a stale revision and a switched account', () => {
    accountSession.setIdentity('vrchat', 'usr_me')
    const revision = favorites.listFriends('vrchat').revision
    for (const ids of [[], ['__proto__'], ['has space'], ['x'.repeat(129)], 'usr_a', [1]]) {
      expect(favorites.setFriends('vrchat', ids, true, revision)).toEqual({
        ok: false,
        reason: 'invalid'
      })
    }
    expect(favorites.setFriends('vrchat', ['usr_a'], 'yes', revision)).toEqual({
      ok: false,
      reason: 'invalid'
    })
    expect(
      favorites.setFriends('vrchat', ['usr_a'], true, { platformAccountId: 'usr_me', epoch: 99 })
    ).toEqual({ ok: false, reason: 'stale' })
    accountSession.setIdentity('vrchat', 'usr_other')
    expect(favorites.setFriends('vrchat', ['usr_a'], true, revision)).toEqual({
      ok: false,
      reason: 'stale'
    })
    expect(storage.writes).toBe(0)
  })

  it('keeps favorite worlds newest first with the name and picture main had', () => {
    accountSession.setIdentity('vrchat', 'usr_me')
    const revision = favorites.listWorlds('vrchat').revision
    expect(favorites.addWorld('vrchat', world(1), revision)).toEqual({ ok: true })
    now = 2_000
    expect(favorites.addWorld('vrchat', world(2, 'N'.repeat(400)), revision)).toEqual({
      ok: true
    })
    const listed = favorites.listWorlds('vrchat').worlds
    expect(listed.map((item) => item.worldId)).toEqual(['wrld_0002', 'wrld_0001'])
    expect(listed[0]!.name).toHaveLength(256)
    expect(listed[1]).toEqual({
      worldId: 'wrld_0001',
      name: 'World 1',
      thumbnailUrl: 'https://files.example/1.png',
      addedAt: 1_000
    })

    // Starring again keeps the first time; unstarring removes it.
    now = 3_000
    expect(favorites.addWorld('vrchat', world(1), revision)).toEqual({ ok: true })
    expect(favorites.listWorlds('vrchat').worlds[1]!.addedAt).toBe(1_000)
    expect(favorites.removeWorld('vrchat', 'wrld_0001', revision)).toEqual({ ok: true })
    expect(favorites.listWorlds('vrchat').worlds.map((item) => item.worldId)).toEqual(['wrld_0002'])
    expect(favorites.removeWorld('vrchat', 'wrld_9999', revision)).toEqual({ ok: true })
    expect(favorites.removeWorld('vrchat', '__proto__', revision)).toEqual({
      ok: false,
      reason: 'invalid'
    })
    // Worlds are per platform account.
    accountSession.setIdentity('chilloutvr', 'cvr-me')
    expect(favorites.listWorlds('chilloutvr').worlds).toEqual([])
  })

  it('stops at the world cap', () => {
    accountSession.setIdentity('vrchat', 'usr_me')
    const revision = favorites.listWorlds('vrchat').revision
    for (let n = 0; n < FAVORITE_WORLDS_MAX; n += 1) {
      expect(favorites.addWorld('vrchat', world(n), revision)).toEqual({ ok: true })
    }
    expect(favorites.addWorld('vrchat', world(FAVORITE_WORLDS_MAX), revision)).toEqual({
      ok: false,
      reason: 'full'
    })
    // An already starred world is still fine.
    expect(favorites.addWorld('vrchat', world(0), revision)).toEqual({ ok: true })
  })
})
