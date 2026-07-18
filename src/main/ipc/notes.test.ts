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

  const setNote = (platform: 'vrchat' | 'chilloutvr', friendId: string, note: string): unknown =>
    handlers.get('set-friend-note')!(event, { platform, friendId, note })

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

    expect(getNote('vrchat', 'usr_a')).toEqual({ note: null })

    expect(setNote('vrchat', 'usr_a', 'Good friend')).toEqual({ ok: true })
    expect(getNote('vrchat', 'usr_a')).toEqual({ note: 'Good friend' })

    // A second friend keeps separate state.
    expect(setNote('vrchat', 'usr_b', 'Another note')).toEqual({ ok: true })
    expect(getNote('vrchat', 'usr_a')).toEqual({ note: 'Good friend' })
    expect(getNote('vrchat', 'usr_b')).toEqual({ note: 'Another note' })
  })

  it('scopes notes per platform + account', () => {
    setIdentity('vrchat', 'usr_vrc')
    setIdentity('chilloutvr', 'usr_cvr')

    setNote('vrchat', 'usr_a', 'VRChat note')
    setNote('chilloutvr', 'usr_a', 'CVR note')

    expect(getNote('vrchat', 'usr_a')).toEqual({ note: 'VRChat note' })
    expect(getNote('chilloutvr', 'usr_a')).toEqual({ note: 'CVR note' })
  })

  it('deletes the key when the note is empty or whitespace-only', () => {
    setIdentity('vrchat', 'usr_self')
    setNote('vrchat', 'usr_a', 'Good friend')

    expect(setNote('vrchat', 'usr_a', '')).toEqual({ ok: true })
    expect(getNote('vrchat', 'usr_a')).toEqual({ note: null })

    setNote('vrchat', 'usr_a', 'Good friend')
    expect(setNote('vrchat', 'usr_a', '   ')).toEqual({ ok: true })
    expect(getNote('vrchat', 'usr_a')).toEqual({ note: null })
  })

  it('trims trailing whitespace for validation and storage', () => {
    setIdentity('vrchat', 'usr_self')

    const longNote = 'a'.repeat(500)
    expect(setNote('vrchat', 'usr_a', `${longNote}   `)).toEqual({ ok: true })
    expect(getNote('vrchat', 'usr_a')).toEqual({ note: longNote })
  })

  it('rejects a note longer than 500 characters after trimming', () => {
    setIdentity('vrchat', 'usr_self')

    const tooLong = 'a'.repeat(501)
    expect(setNote('vrchat', 'usr_a', tooLong)).toEqual({ ok: false, reason: 'invalid' })
    expect(setNote('vrchat', 'usr_a', `${tooLong}   `)).toEqual({ ok: false, reason: 'invalid' })
    expect(storage.writes).toHaveLength(0)
  })

  it('rejects an empty friendId', () => {
    setIdentity('vrchat', 'usr_self')

    expect(setNote('vrchat', '', 'hello')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('returns stale when the store rejects a stale epoch', () => {
    setIdentity('vrchat', 'usr_self')
    const write = vi.spyOn(socialStore, 'write').mockImplementationOnce(() => {
      throw new Error('social store: stale account epoch')
    })

    expect(setNote('vrchat', 'usr_a', 'after boundary')).toEqual({ ok: false, reason: 'stale' })
    expect(write).toHaveBeenCalledOnce()
  })

  it('rejects invalid platform values at both channels', () => {
    expect(() =>
      handlers.get('get-friend-note')!(event, { platform: 'steam', friendId: 'usr_a' })
    ).toThrow('Invalid get-friend-note request')
    expect(() =>
      handlers.get('set-friend-note')!(event, { platform: 'steam', friendId: 'usr_a', note: 'x' })
    ).toThrow('Invalid set-friend-note request')
  })

  it('writes the full NotesData record on every update', () => {
    setIdentity('vrchat', 'usr_self')
    setNote('vrchat', 'usr_a', 'first')
    setNote('vrchat', 'usr_b', 'second')

    const latest = storage.writes.at(-1)
    expect(latest).toBeDefined()
    const account = latest?.accounts['vrchat:usr_self'] as
      { notes: { data: NotesData } } | undefined
    expect(account?.notes.data).toEqual({
      usr_a: 'first',
      usr_b: 'second'
    })
  })
})
