import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Platform } from '@shared/types'
import { ACCOUNT_NOTE_WRITE_SPACING_MS } from '@shared/accountNotes'

vi.mock('electron-store', () => ({ default: class {} }))

import { AccountSession } from './accountSession'
import { SocialStore, type SocialStoreStorage } from './socialStore'
import { AccountNoteService, type AccountNoteRequest } from './accountNotes'
import type { AccountNoteAdapter } from './adapters/AccountNoteAdapter'
import type { RequestLease } from './adapters/RequestLease'
import { AuthError, RateLimitError } from './adapters/errors'

const ME = 'usr_me'
const FRIEND = 'usr_friend'

class MemorySocialStorage implements SocialStoreStorage {
  value: unknown = {}
  read(): unknown {
    return this.value
  }
  write(value: { storeFormatVersion: number; accounts: Record<string, unknown> }): void {
    this.value = structuredClone(value)
  }
}

class FakeAdapter implements AccountNoteAdapter {
  readonly platform: Platform = 'vrchat'
  account: string | null = ''
  reads = 0
  writes: string[] = []
  readError: Error | null = null
  writeError: Error | null = null
  generation = 1
  current = true
  signedIn = true

  captureNoteLease(): RequestLease {
    if (!this.signedIn) throw new Error('no session')
    const controller = new AbortController()
    return {
      generation: this.generation,
      signal: controller.signal,
      isCurrent: () => this.current
    }
  }
  async readAccountNote(): Promise<string | null> {
    this.reads += 1
    if (this.readError) throw this.readError
    return this.account
  }
  async writeAccountNote(_userId: string, note: string): Promise<void> {
    this.writes.push(note)
    if (this.writeError) throw this.writeError
    this.account = note
  }
}

describe('AccountNoteService', () => {
  let session: AccountSession
  let store: SocialStore
  let adapter: FakeAdapter
  let enabled: boolean
  let friends: Set<string>
  let now: number
  let slept: number[]
  let service: AccountNoteService

  function request(mode: AccountNoteRequest['mode']): AccountNoteRequest {
    const resolution = session.resolve('vrchat')
    if ('status' in resolution) throw new Error('signed out')
    return {
      platform: 'vrchat',
      friendId: FRIEND,
      revision: { platformAccountId: ME, epoch: resolution.epoch },
      mode
    }
  }
  function context(): { platform: Platform; platformAccountId: string; epoch: number } {
    return { platform: 'vrchat', platformAccountId: ME, epoch: request('check').revision.epoch }
  }
  function setLocal(note: string): void {
    store.write(context(), 'notes', note === '' ? {} : { [FRIEND]: note })
  }
  function local(): string | undefined {
    return store.read('vrchat', ME, 'notes')?.data?.[FRIEND]
  }
  function agreed(): string | undefined {
    return store.read('vrchat', ME, 'noteSync')?.data?.[FRIEND]
  }

  beforeEach(() => {
    session = new AccountSession()
    session.setIdentity('vrchat', ME)
    store = new SocialStore(session, new MemorySocialStorage())
    adapter = new FakeAdapter()
    enabled = true
    friends = new Set([FRIEND])
    now = 0
    slept = []
    service = new AccountNoteService({
      adapters: new Map([['vrchat', adapter]]),
      socialStore: store,
      accountSession: session,
      isFriend: (_platform, id) => friends.has(id),
      isEnabled: () => enabled,
      clock: () => now,
      sleep: async (ms) => {
        slept.push(ms)
        now += ms
      }
    })
  })

  it('a check never writes to the account', async () => {
    setLocal('Plays drums')
    await expect(service.sync(request('check'))).resolves.toEqual({
      ok: true,
      state: 'local-only',
      note: 'Plays drums'
    })
    expect(adapter.writes).toEqual([])
  })

  it('a save sends a note the account does not have, then they agree', async () => {
    setLocal('Plays drums\nand guitar')
    await expect(service.sync(request('save'))).resolves.toMatchObject({ state: 'saved' })
    expect(adapter.writes).toEqual(['Plays drums and guitar'])
    expect(agreed()).toBe('Plays drums and guitar')
    // VRChat's look-alike symbols in its copy still count as the same note.
    adapter.account = 'Plays drums and guitar'
    await expect(service.sync(request('check'))).resolves.toMatchObject({ state: 'saved' })
  })

  it('takes an account note when VRX has none, without a write', async () => {
    adapter.account = 'Met at ＃meetup'
    await expect(service.sync(request('check'))).resolves.toEqual({
      ok: true,
      state: 'account-changed',
      note: '',
      accountNote: 'Met at #meetup'
    })
    await expect(service.sync(request('use-account'))).resolves.toMatchObject({
      state: 'saved',
      note: 'Met at #meetup'
    })
    expect(local()).toBe('Met at #meetup')
    expect(adapter.writes).toEqual([])
    // The account copy read for the check is reused, not read again.
    expect(adapter.reads).toBe(1)
  })

  it('a save never wipes an account note VRX has not seen', async () => {
    adapter.account = 'Written in the game'
    setLocal('')
    await expect(service.sync(request('save'))).resolves.toMatchObject({
      state: 'account-changed'
    })
    expect(adapter.writes).toEqual([])
  })

  it('asks when both copies changed since they last agreed', async () => {
    setLocal('old')
    adapter.account = 'old'
    await service.sync(request('check'))
    expect(agreed()).toBe('old')

    setLocal('mine')
    adapter.account = 'theirs'
    await expect(service.sync(request('save'))).resolves.toEqual({
      ok: true,
      state: 'conflict',
      note: 'mine',
      accountNote: 'theirs'
    })
    expect(adapter.writes).toEqual([])
  })

  it('keep mine replaces only the account copy the user was shown', async () => {
    setLocal('mine')
    adapter.account = 'theirs'
    await service.sync(request('save'))

    adapter.account = 'changed again'
    await expect(service.sync(request('keep-mine'))).resolves.toMatchObject({
      state: 'conflict',
      accountNote: 'changed again'
    })
    expect(adapter.writes).toEqual([])

    await expect(service.sync(request('keep-mine'))).resolves.toMatchObject({ state: 'saved' })
    expect(adapter.writes).toEqual(['mine'])
    expect(agreed()).toBe('mine')
  })

  it('use the account note replaces VRX copy after a conflict', async () => {
    setLocal('mine')
    adapter.account = 'theirs'
    await service.sync(request('save'))
    await expect(service.sync(request('use-account'))).resolves.toMatchObject({
      state: 'saved',
      note: 'theirs'
    })
    expect(local()).toBe('theirs')
  })

  it('takes a later account edit when VRX copy did not change', async () => {
    setLocal('old')
    adapter.account = 'old'
    await service.sync(request('check'))
    adapter.account = 'edited in the game'
    now += 10 * 60_000
    await expect(service.sync(request('check'))).resolves.toMatchObject({
      state: 'account-changed',
      accountNote: 'edited in the game'
    })
  })

  it('a cleared VRX note clears the account copy on save', async () => {
    setLocal('old')
    adapter.account = 'old'
    await service.sync(request('check'))
    setLocal('')
    await expect(service.sync(request('save'))).resolves.toMatchObject({ state: 'saved' })
    expect(adapter.writes).toEqual([''])
  })

  it('refuses to write a VRChat note longer than 256 characters', async () => {
    setLocal('x'.repeat(300))
    await expect(service.sync(request('save'))).resolves.toMatchObject({ state: 'too-long' })
    expect(adapter.writes).toEqual([])
  })

  it('refuses to write when the reply did not say what the account holds', async () => {
    setLocal('mine')
    adapter.account = null
    await expect(service.sync(request('save'))).resolves.toEqual({
      ok: false,
      reason: 'unavailable'
    })
    expect(adapter.writes).toEqual([])
  })

  it('reports failures without retrying', async () => {
    setLocal('mine')
    adapter.writeError = new RateLimitError(1000)
    await expect(service.sync(request('save'))).resolves.toEqual({
      ok: false,
      reason: 'rate-limited'
    })
    expect(adapter.writes).toHaveLength(1)
    expect(agreed()).toBeUndefined()

    adapter.readError = new AuthError()
    await expect(service.sync(request('save'))).resolves.toEqual({
      ok: false,
      reason: 'not-authenticated'
    })
  })

  it('spaces writes on a platform', async () => {
    setLocal('one')
    await service.sync(request('save'))
    setLocal('two')
    await service.sync(request('save'))
    expect(adapter.writes).toEqual(['one', 'two'])
    expect(slept).toEqual([ACCOUNT_NOTE_WRITE_SPACING_MS])
  })

  it('does nothing when the setting is off, for non-friends, or across accounts', async () => {
    setLocal('mine')
    enabled = false
    await expect(service.sync(request('save'))).resolves.toEqual({
      ok: true,
      state: 'off',
      note: 'mine'
    })
    enabled = true
    friends.clear()
    await expect(service.sync(request('save'))).resolves.toEqual({
      ok: false,
      reason: 'not-friend'
    })
    friends.add(FRIEND)
    const old = request('save')
    session.setIdentity('vrchat', 'usr_other')
    await expect(service.sync(old)).resolves.toEqual({ ok: false, reason: 'stale' })
    expect(adapter.reads).toBe(0)
    expect(adapter.writes).toEqual([])
  })

  it('does not write once the session has changed', async () => {
    setLocal('mine')
    adapter.current = false
    await expect(service.sync(request('save'))).resolves.toEqual({ ok: false, reason: 'stale' })
    expect(adapter.writes).toEqual([])
  })

  it('runs one call per friend at a time', async () => {
    setLocal('mine')
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const read = adapter.readAccountNote.bind(adapter)
    let inFlight = 0
    let most = 0
    adapter.readAccountNote = async () => {
      inFlight += 1
      most = Math.max(most, inFlight)
      await gate
      inFlight -= 1
      return read()
    }
    const first = service.sync(request('save'))
    const second = service.sync(request('save'))
    release()
    await Promise.all([first, second])
    expect(most).toBe(1)
    expect(adapter.writes).toEqual(['mine'])
  })
})
