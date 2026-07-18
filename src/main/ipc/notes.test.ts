import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { AccountSession } from '../services/accountSession'
import { SocialStore, type NotesData, type SocialStoreStorage } from '../services/socialStore'

const handlers = new Map<string, (event: unknown, req: unknown) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, req: unknown) => unknown) => {
      handlers.set(channel, fn)
    })
  }
}))

vi.mock('electron-store', () => ({ default: class {} }))

const trusted = vi.hoisted(() => ({ value: true }))
vi.mock('./security', () => ({ isTrustedIpcSender: vi.fn(() => trusted.value) }))

import { registerNotesHandlers } from './notes'

const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent

class MemorySocialStorage implements SocialStoreStorage {
  value: unknown = {}
  writes: { storeFormatVersion: number; accounts: Record<string, unknown> }[] = []

  read(): unknown {
    return this.value
  }

  write(value: { storeFormatVersion: number; accounts: Record<string, unknown> }): void {
    this.value = structuredClone(value)
    this.writes.push(structuredClone(value))
  }
}

describe('notes handlers', () => {
  let accountSession: AccountSession
  let storage: MemorySocialStorage
  let socialStore: SocialStore

  beforeEach(() => {
    handlers.clear()
    trusted.value = true
    accountSession = new AccountSession()
    storage = new MemorySocialStorage()
    socialStore = new SocialStore(accountSession, storage)
    registerNotesHandlers({ accountSession, socialStore })
  })

  const setIdentity = (platform: 'vrchat' | 'chilloutvr', id: string): void => {
    accountSession.setIdentity(platform, id)
  }

  const getNote = (platform: 'vrchat' | 'chilloutvr', friendId: string): unknown =>
    handlers.get('get-friend-note')!(event, { platform, friendId })

  const extractRevision = (res: unknown): { platformAccountId: string; epoch: number } =>
    (res as { revision: { platformAccountId: string; epoch: number } }).revision

  const setNote = (
    platform: 'vrchat' | 'chilloutvr',
    friendId: string,
    note: string,
    revision?: { platformAccountId: string; epoch: number }
  ): unknown => handlers.get('set-friend-note')!(event, { platform, friendId, note, revision })

  it('rejects an untrusted sender before touching the store', () => {
    trusted.value = false

    expect(() => getNote('vrchat', 'usr_a')).toThrow('Untrusted IPC sender')
    expect(() => setNote('vrchat', 'usr_a', 'hello')).toThrow('Untrusted IPC sender')
    expect(storage.writes).toHaveLength(0)
  })

  it('returns note:null when no account is active', () => {
    expect(getNote('vrchat', 'usr_a')).toEqual({ note: null })
  })

  it('returns set ok:false not-authenticated when no account is active', () => {
    expect(setNote('vrchat', 'usr_a', 'hello')).toEqual({
      ok: false,
      reason: 'not-authenticated'
    })
  })

  it('round-trips a note through get and set', () => {
    setIdentity('vrchat', 'usr_self')

    const revision = extractRevision(getNote('vrchat', 'usr_a'))
    expect(revision).toEqual({ platformAccountId: 'usr_self', epoch: 1 })
    expect(setNote('vrchat', 'usr_a', 'Good friend', revision)).toEqual({ ok: true })

    const get2 = getNote('vrchat', 'usr_a') as { note: string; revision: unknown }
    expect(get2.note).toBe('Good friend')
    expect(get2.revision).toEqual({ platformAccountId: 'usr_self', epoch: 1 })

    // A second friend keeps separate state.
    expect(setNote('vrchat', 'usr_b', 'Another note', revision)).toEqual({ ok: true })
    expect(getNote('vrchat', 'usr_a')).toEqual({
      note: 'Good friend',
      revision: extractRevision(getNote('vrchat', 'usr_a'))
    })
    expect(getNote('vrchat', 'usr_b')).toEqual({
      note: 'Another note',
      revision: extractRevision(getNote('vrchat', 'usr_b'))
    })
  })

  it('scopes notes per platform + account', () => {
    setIdentity('vrchat', 'usr_vrc')
    setIdentity('chilloutvr', 'usr_cvr')

    const vrcRevision = extractRevision(getNote('vrchat', 'usr_a'))
    const cvrRevision = extractRevision(getNote('chilloutvr', 'usr_a'))

    expect(setNote('vrchat', 'usr_a', 'VRChat note', vrcRevision)).toEqual({ ok: true })
    expect(setNote('chilloutvr', 'usr_a', 'CVR note', cvrRevision)).toEqual({ ok: true })

    expect(getNote('vrchat', 'usr_a')).toEqual({ note: 'VRChat note', revision: vrcRevision })
    expect(getNote('chilloutvr', 'usr_a')).toEqual({ note: 'CVR note', revision: cvrRevision })
  })

  it('deletes the key when the note is empty or whitespace-only', () => {
    setIdentity('vrchat', 'usr_self')
    const revision = extractRevision(getNote('vrchat', 'usr_a'))

    expect(setNote('vrchat', 'usr_a', 'Good friend', revision)).toEqual({ ok: true })
    expect(setNote('vrchat', 'usr_a', '', revision)).toEqual({ ok: true })
    expect(getNote('vrchat', 'usr_a')).toEqual({ note: null, revision })

    expect(setNote('vrchat', 'usr_a', 'Good friend', revision)).toEqual({ ok: true })
    expect(setNote('vrchat', 'usr_a', '   ', revision)).toEqual({ ok: true })
    expect(getNote('vrchat', 'usr_a')).toEqual({ note: null, revision })
  })

  it('trims trailing whitespace for validation and storage', () => {
    setIdentity('vrchat', 'usr_self')
    const revision = extractRevision(getNote('vrchat', 'usr_a'))

    const longNote = 'a'.repeat(500)
    expect(setNote('vrchat', 'usr_a', `${longNote}   `, revision)).toEqual({ ok: true })
    expect(getNote('vrchat', 'usr_a')).toEqual({ note: longNote, revision })
  })

  it('rejects a note longer than 500 characters after trimming', () => {
    setIdentity('vrchat', 'usr_self')
    const revision = extractRevision(getNote('vrchat', 'usr_a'))

    const tooLong = 'a'.repeat(501)
    expect(setNote('vrchat', 'usr_a', tooLong, revision)).toEqual({ ok: false, reason: 'invalid' })
    expect(setNote('vrchat', 'usr_a', `${tooLong}   `, revision)).toEqual({
      ok: false,
      reason: 'invalid'
    })
    expect(storage.writes).toHaveLength(0)
  })

  it('rejects an empty friendId', () => {
    setIdentity('vrchat', 'usr_self')
    const revision = extractRevision(getNote('vrchat', 'usr_a'))

    expect(setNote('vrchat', '', 'hello', revision)).toEqual({ ok: false, reason: 'invalid' })
    expect(getNote('vrchat', '')).toEqual({ note: null })
  })

  it('returns stale when the store rejects a stale epoch', () => {
    setIdentity('vrchat', 'usr_self')
    const revision = extractRevision(getNote('vrchat', 'usr_a'))
    const write = vi.spyOn(socialStore, 'write').mockImplementationOnce(() => {
      throw new Error('social store: stale account epoch')
    })

    expect(setNote('vrchat', 'usr_a', 'after boundary', revision)).toEqual({
      ok: false,
      reason: 'stale'
    })
    expect(write).toHaveBeenCalledOnce()
  })

  it('rejects invalid platform values at both channels', () => {
    expect(() =>
      handlers.get('get-friend-note')!(event, { platform: 'steam', friendId: 'usr_a' })
    ).toThrow('Invalid get-friend-note request')
    expect(() =>
      handlers.get('set-friend-note')!(event, {
        platform: 'steam',
        friendId: 'usr_a',
        note: 'x',
        revision: { platformAccountId: 'x', epoch: 1 }
      })
    ).toThrow('Invalid set-friend-note request')
  })

  it('writes the full NotesData record on every update', () => {
    setIdentity('vrchat', 'usr_self')
    const revision = extractRevision(getNote('vrchat', 'usr_a'))

    setNote('vrchat', 'usr_a', 'first', revision)
    setNote('vrchat', 'usr_b', 'second', revision)

    const latest = storage.writes.at(-1)
    expect(latest).toBeDefined()
    const account = latest?.accounts['vrchat:usr_self'] as
      { notes: { data: NotesData } } | undefined
    expect(account?.notes.data).toEqual({
      usr_a: 'first',
      usr_b: 'second'
    })
  })

  it('echoes the lease: get returns the current account revision and set requires it', () => {
    setIdentity('vrchat', 'usr_self')
    const revision = extractRevision(getNote('vrchat', 'usr_a'))

    expect(revision).toEqual({ platformAccountId: 'usr_self', epoch: 1 })
    expect(setNote('vrchat', 'usr_a', 'hello', revision)).toEqual({ ok: true })
  })

  it('rejects set with a stale echoed lease before writing', () => {
    setIdentity('vrchat', 'usr_self')
    const oldRevision = extractRevision(getNote('vrchat', 'usr_a'))

    // Simulate account switch: same friend, new epoch.
    accountSession.setIdentity('vrchat', 'usr_other')
    const newRevision = extractRevision(getNote('vrchat', 'usr_a'))
    expect(newRevision).toEqual({ platformAccountId: 'usr_other', epoch: 2 })

    // Write using the old lease must fail as stale without touching the store.
    expect(setNote('vrchat', 'usr_a', 'leaked', oldRevision)).toEqual({
      ok: false,
      reason: 'stale'
    })
    expect(storage.writes).toHaveLength(0)

    // Write using the current lease succeeds.
    expect(setNote('vrchat', 'usr_a', 'valid', newRevision)).toEqual({ ok: true })
  })

  it('rejects set with a lease from a different account', () => {
    setIdentity('vrchat', 'usr_a')
    setIdentity('vrchat', 'usr_b')
    const revisionB = extractRevision(getNote('vrchat', 'usr_x'))

    setIdentity('vrchat', 'usr_c')
    expect(setNote('vrchat', 'usr_x', 'cross-account', revisionB)).toEqual({
      ok: false,
      reason: 'stale'
    })
    expect(storage.writes).toHaveLength(0)
  })

  it('rejects forbidden and malformed friendIds with typed responses, never throwing', () => {
    setIdentity('vrchat', 'usr_self')
    const revision = extractRevision(getNote('vrchat', 'usr_a'))

    for (const friendId of ['__proto__', 'constructor', 'prototype']) {
      expect(setNote('vrchat', friendId, 'x', revision)).toEqual({ ok: false, reason: 'invalid' })
      expect(getNote('vrchat', friendId)).toEqual({ note: null })
    }

    // 300-char id is over the conservative 128-char limit.
    const longId = 'a'.repeat(300)
    expect(setNote('vrchat', longId, 'x', revision)).toEqual({ ok: false, reason: 'invalid' })
    expect(getNote('vrchat', longId)).toEqual({ note: null })

    // Whitespace / control characters are rejected.
    expect(setNote('vrchat', 'usr a', 'x', revision)).toEqual({ ok: false, reason: 'invalid' })
    expect(getNote('vrchat', 'usr a')).toEqual({ note: null })

    expect(storage.writes).toHaveLength(0)
  })

  it('does not allow prototype keys to pollute the notes record', () => {
    setIdentity('vrchat', 'usr_self')
    const revision = extractRevision(getNote('vrchat', 'usr_a'))

    // __proto__ cannot be set as a note key.
    expect(setNote('vrchat', '__proto__', 'polluted', revision)).toEqual({
      ok: false,
      reason: 'invalid'
    })

    // A normal key still writes and reads back.
    expect(setNote('vrchat', 'usr_a', 'safe', revision)).toEqual({ ok: true })
    expect(getNote('vrchat', 'usr_a')).toEqual({ note: 'safe', revision })
  })

  it('maps unexpected SocialStore throws to invalid instead of IPC exceptions', () => {
    setIdentity('vrchat', 'usr_self')
    const revision = extractRevision(getNote('vrchat', 'usr_a'))
    vi.spyOn(socialStore, 'write').mockImplementationOnce(() => {
      throw new Error('zod validation failed')
    })

    expect(setNote('vrchat', 'usr_a', 'hello', revision)).toEqual({ ok: false, reason: 'invalid' })
  })
})
