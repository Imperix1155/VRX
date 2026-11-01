import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CVRCredentials } from './CvrApiClient'
import { CvrAdapter, type CvrCredentialStore } from './CvrAdapter'
import { VrcAdapter, type VrcCredentialStore } from './VrcAdapter'
import { CommunityDataError } from './CommunityAdapter'
import { AuthError } from './errors'
import { parseAccountNoteReply } from './AccountNoteAdapter'
import {
  instantAdmission,
  jsonResponse,
  markVrcSessionEstablished
} from './__testutils__/adapterTestKit'

const VRC_ME = 'usr_12345678-1234-1234-1234-123456789abc'
const VRC_FRIEND = 'usr_aaaaaaaa-1234-1234-1234-123456789abc'
const CVR_ME = '3a1661f1-3eeb-426e-92ec-1b2f08e609b5'
const CVR_FRIEND = 'b81d5892-5119-4f44-b473-7bf4ffda0458'

function vrcSignedIn(): VrcAdapter {
  const store: VrcCredentialStore = {
    load: () => 'auth=synthetic',
    save: () => {},
    delete: () => {}
  }
  const adapter = new VrcAdapter(store, instantAdmission())
  markVrcSessionEstablished(adapter)
  Object.assign(adapter as unknown as { accountId: string }, { accountId: VRC_ME })
  return adapter
}

function cvrSignedIn(): CvrAdapter {
  const credentials: CVRCredentials = { username: 'cvr-user', accessKey: 'cvr-access-key' }
  const store: CvrCredentialStore = { load: () => credentials, save: () => {}, delete: () => {} }
  const adapter = new CvrAdapter(store, instantAdmission())
  Object.assign(
    adapter as unknown as { validated: boolean; accountId: string; displayName: string },
    { validated: true, accountId: CVR_ME, displayName: 'Guide visitor' }
  )
  return adapter
}

describe('parseAccountNoteReply', () => {
  const same = (left: string, right: string): boolean => left === right
  it('reads the note, an empty note, and a null note as empty', () => {
    expect(parseAccountNoteReply({ id: 'a', note: 'hi' }, 'a', same)).toBe('hi')
    expect(parseAccountNoteReply({ id: 'a', note: '' }, 'a', same)).toBe('')
    expect(parseAccountNoteReply({ id: 'a', note: null }, 'a', same)).toBe('')
  })
  it('treats a reply that does not say as unknown, never as empty', () => {
    expect(parseAccountNoteReply({ id: 'a' }, 'a', same)).toBeNull()
    expect(parseAccountNoteReply({ id: 'a', note: 5 }, 'a', same)).toBeNull()
    expect(parseAccountNoteReply({ id: 'b', note: 'hi' }, 'a', same)).toBeNull()
    expect(parseAccountNoteReply(null, 'a', same)).toBeNull()
    expect(parseAccountNoteReply([], 'a', same)).toBeNull()
  })
})

describe('VrcAdapter account notes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reads the note from /users/{id}', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: VRC_FRIEND, note: 'Met at a meetup' }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = vrcSignedIn()

    await expect(adapter.readAccountNote(VRC_FRIEND, adapter.captureNoteLease())).resolves.toBe(
      'Met at a meetup'
    )
    const [url, options] = fetchMock.mock.calls[0]!
    expect(url).toBe(`https://api.vrchat.cloud/api/1/users/${VRC_FRIEND}`)
    expect(options).toMatchObject({ method: 'GET' })
  })

  it('writes with one POST /userNotes and never sends it twice', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = vrcSignedIn()

    await expect(
      adapter.writeAccountNote(VRC_FRIEND, 'Plays drums', adapter.captureNoteLease())
    ).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.vrchat.cloud/api/1/userNotes')
    expect(options).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(JSON.parse(String(options.body))).toEqual({
      targetUserId: VRC_FRIEND,
      note: 'Plays drums'
    })
    expect(options.headers).toMatchObject({
      Cookie: 'auth=synthetic',
      'Content-Type': 'application/json'
    })
  })

  it('refuses a malformed user id before any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const adapter = vrcSignedIn()
    await expect(
      adapter.writeAccountNote('usr_x/../auth', 'x', adapter.captureNoteLease())
    ).rejects.toBeInstanceOf(CommunityDataError)
    await expect(
      adapter.readAccountNote('../auth', adapter.captureNoteLease())
    ).rejects.toBeInstanceOf(CommunityDataError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a 401 invalidates the session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    const adapter = vrcSignedIn()
    const events: string[] = []
    adapter.subscribe((event) => events.push(event.type))
    await expect(
      adapter.writeAccountNote(VRC_FRIEND, 'x', adapter.captureNoteLease())
    ).rejects.toBeInstanceOf(AuthError)
    expect(events).toContain('auth-invalidated')
  })

  it('needs a durable session to capture a lease', () => {
    const adapter = new VrcAdapter(
      { load: () => 'auth=synthetic', save: () => {}, delete: () => {} },
      instantAdmission()
    )
    expect(() => adapter.captureNoteLease()).toThrow()
  })
})

describe('CvrAdapter account notes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reads the note from /users/{id}, matching the id in any case', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ message: 'ok', data: { id: CVR_FRIEND.toUpperCase(), note: 'Builder' } })
      )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = cvrSignedIn()

    await expect(
      adapter.readAccountNote(CVR_FRIEND.toUpperCase(), adapter.captureNoteLease())
    ).resolves.toBe('Builder')
    const [url, options] = fetchMock.mock.calls[0]!
    expect(url).toBe(`https://api.abinteractive.net/1/users/${CVR_FRIEND}`)
    expect(options.headers).toMatchObject({ Username: 'cvr-user', AccessKey: 'cvr-access-key' })
  })

  it('writes with one POST /users/{id}/note, as CVRX does', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'Note updated', data: null }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = cvrSignedIn()

    await adapter.writeAccountNote(CVR_FRIEND, 'Builder\nand artist', adapter.captureNoteLease())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]!
    expect(url).toBe(`https://api.abinteractive.net/1/users/${CVR_FRIEND}/note`)
    expect(options).toMatchObject({ method: 'POST' })
    expect(JSON.parse(String(options.body))).toEqual({ note: 'Builder\nand artist' })
  })

  it('refuses a malformed user id before any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const adapter = cvrSignedIn()
    await expect(
      adapter.writeAccountNote('not-a-guid', 'x', adapter.captureNoteLease())
    ).rejects.toBeInstanceOf(CommunityDataError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
