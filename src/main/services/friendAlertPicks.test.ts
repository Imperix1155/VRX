import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountSession } from './accountSession'
import { SocialStore, type SocialStoreStorage } from './socialStore'
import { ALERT_PICKS_MAX, FriendAlertPicks } from './friendAlertPicks'

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

describe('FriendAlertPicks', () => {
  let accountSession: AccountSession
  let storage: MemorySocialStorage
  let socialStore: SocialStore
  let picks: FriendAlertPicks

  beforeEach(() => {
    accountSession = new AccountSession()
    storage = new MemorySocialStorage()
    socialStore = new SocialStore(accountSession, storage)
    picks = new FriendAlertPicks(accountSession, socialStore)
  })

  it('has no picks and no revision while signed out, and refuses a write', () => {
    expect(picks.list('vrchat')).toEqual({ friendIds: [] })
    expect(picks.isPicked('vrchat', 'usr_a')).toBe(false)
    expect(picks.set('vrchat', ['usr_a'], true, { platformAccountId: 'usr_me', epoch: 1 })).toEqual(
      {
        ok: false,
        reason: 'not-authenticated'
      }
    )
    expect(storage.writes).toBe(0)
  })

  it('picks and unpicks a friend for the signed-in account on each platform', () => {
    accountSession.setIdentity('vrchat', 'usr_me')
    accountSession.setIdentity('chilloutvr', 'cvr-me')
    const vrc = picks.list('vrchat').revision
    const cvr = picks.list('chilloutvr').revision

    expect(picks.set('vrchat', ['usr_a'], true, vrc)).toEqual({ ok: true })
    expect(picks.set('chilloutvr', ['cvr-a'], true, cvr)).toEqual({ ok: true })
    expect(picks.isPicked('vrchat', 'usr_a')).toBe(true)
    expect(picks.isPicked('chilloutvr', 'cvr-a')).toBe(true)
    expect(picks.isPicked('vrchat', 'cvr-a')).toBe(false)
    expect(picks.list('vrchat').friendIds).toEqual(['usr_a'])

    expect(picks.set('vrchat', ['usr_a'], false, vrc)).toEqual({ ok: true })
    expect(picks.isPicked('vrchat', 'usr_a')).toBe(false)
    expect(picks.isPicked('chilloutvr', 'cvr-a')).toBe(true)
  })

  it('keeps each account separate and survives a restart', () => {
    accountSession.setIdentity('vrchat', 'usr_me')
    picks.set('vrchat', ['usr_a'], true, picks.list('vrchat').revision)

    accountSession.setIdentity('vrchat', 'usr_other')
    expect(picks.isPicked('vrchat', 'usr_a')).toBe(false)
    expect(picks.list('vrchat').friendIds).toEqual([])

    accountSession.setIdentity('vrchat', 'usr_me')
    expect(picks.isPicked('vrchat', 'usr_a')).toBe(true)

    const restarted = new FriendAlertPicks(accountSession, new SocialStore(accountSession, storage))
    expect(restarted.isPicked('vrchat', 'usr_a')).toBe(true)
  })

  it('refuses a stale revision from an earlier account or epoch', () => {
    accountSession.setIdentity('vrchat', 'usr_me')
    const before = picks.list('vrchat').revision
    accountSession.setIdentity('vrchat', 'usr_other')

    expect(picks.set('vrchat', ['usr_a'], true, before)).toEqual({ ok: false, reason: 'stale' })
    expect(picks.set('vrchat', ['usr_a'], true, undefined)).toEqual({ ok: false, reason: 'stale' })
    expect(storage.writes).toBe(0)
  })

  it('refuses invalid ids and values without writing', () => {
    accountSession.setIdentity('vrchat', 'usr_me')
    const revision = picks.list('vrchat').revision
    for (const friendIds of [
      [],
      [''],
      ['__proto__'],
      ['a b'],
      ['x'.repeat(129)],
      [7],
      'usr_a',
      null,
      ['usr_a', 'bad id']
    ]) {
      expect(picks.set('vrchat', friendIds, true, revision)).toEqual({
        ok: false,
        reason: 'invalid'
      })
    }
    expect(picks.set('vrchat', ['usr_a'], 'yes', revision)).toEqual({
      ok: false,
      reason: 'invalid'
    })
    expect(storage.writes).toBe(0)
  })

  it('does not rewrite the file when nothing changes', () => {
    accountSession.setIdentity('vrchat', 'usr_me')
    const revision = picks.list('vrchat').revision
    picks.set('vrchat', ['usr_a'], false, revision)
    picks.set('vrchat', ['usr_a'], true, revision)
    picks.set('vrchat', ['usr_a'], true, revision)
    expect(storage.writes).toBe(1)
  })

  it('stops at the cap instead of growing the file without bound', () => {
    accountSession.setIdentity('vrchat', 'usr_me')
    const revision = picks.list('vrchat').revision
    storage.value = {
      storeFormatVersion: 1,
      accounts: {
        'vrchat:usr_me': {
          socialPrefs: {
            schemaVersion: 1,
            platform: 'vrchat',
            platformAccountId: 'usr_me',
            data: { followedFriendIds: Array.from({ length: ALERT_PICKS_MAX }, (_, i) => `u${i}`) }
          }
        }
      }
    }
    const full = new FriendAlertPicks(accountSession, new SocialStore(accountSession, storage))
    expect(full.set('vrchat', ['usr_new'], true, revision)).toEqual({ ok: false, reason: 'full' })
    expect(full.set('vrchat', ['u0'], false, revision)).toEqual({ ok: true })
  })

  it('reports a storage it could not load as invalid instead of overwriting it', () => {
    storage.value = 'not json'
    const broken = new FriendAlertPicks(accountSession, new SocialStore(accountSession, storage))
    accountSession.setIdentity('vrchat', 'usr_me')
    expect(broken.set('vrchat', ['usr_a'], true, broken.list('vrchat').revision)).toEqual({
      ok: false,
      reason: 'invalid'
    })
    expect(storage.writes).toBe(0)
  })

  it('writes several picks in one save', () => {
    accountSession.setIdentity('chilloutvr', 'cvr-me')
    const revision = picks.list('chilloutvr').revision
    expect(picks.set('chilloutvr', ['a', 'b', 'c'], true, revision)).toEqual({ ok: true })
    expect(picks.set('chilloutvr', ['a', 'c'], false, revision)).toEqual({ ok: true })
    expect(picks.list('chilloutvr').friendIds).toEqual(['b'])
    expect(storage.writes).toBe(2)
  })
})
