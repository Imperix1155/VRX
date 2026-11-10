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

describe("one read of a person's record for their details", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('VRChat: the full profile after the note check uses the same answer', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ id: VRC_FRIEND, displayName: 'Friend', note: 'Met at a meetup' })
    )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = vrcSignedIn()

    await expect(adapter.readAccountNote(VRC_FRIEND, adapter.captureNoteLease())).resolves.toBe(
      'Met at a meetup'
    )
    await expect(
      adapter.getProfile(VRC_FRIEND, adapter.captureCommunityLease())
    ).resolves.toMatchObject({ userId: VRC_FRIEND, displayName: 'Friend' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('ChilloutVR: the full profile and block check after the note check use the same answer', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        message: 'ok',
        data: { id: CVR_FRIEND, name: 'Friend', note: 'Builder', isBlocked: false }
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = cvrSignedIn()

    await expect(adapter.readAccountNote(CVR_FRIEND, adapter.captureNoteLease())).resolves.toBe(
      'Builder'
    )
    await expect(
      adapter.getProfile(CVR_FRIEND, adapter.captureCommunityLease())
    ).resolves.toMatchObject({ userId: CVR_FRIEND, displayName: 'Friend' })
    await expect(adapter.getBlocked(CVR_FRIEND, adapter.captureSocialLease())).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('joins a read that is still out', async () => {
    let answer!: () => void
    const held = new Promise<void>((resolve) => {
      answer = resolve
    })
    const fetchMock = vi.fn(async () => {
      await held
      return jsonResponse({ message: 'ok', data: { id: CVR_FRIEND, name: 'Friend', note: '' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const adapter = cvrSignedIn()

    const note = adapter.readAccountNote(CVR_FRIEND, adapter.captureNoteLease())
    const profile = adapter.getProfile(CVR_FRIEND, adapter.captureCommunityLease())
    answer()
    await expect(note).resolves.toBe('')
    await expect(profile).resolves.toMatchObject({ userId: CVR_FRIEND })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('a note read always asks again, so a save sees what the account holds now', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ id: VRC_FRIEND, displayName: 'Friend', note: 'Met at a meetup' })
    )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = vrcSignedIn()

    await adapter.getProfile(VRC_FRIEND, adapter.captureCommunityLease())
    await adapter.readAccountNote(VRC_FRIEND, adapter.captureNoteLease())
    await adapter.readAccountNote(VRC_FRIEND, adapter.captureNoteLease())
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('reads the person again once the shared answer is 30 seconds old', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000)
    const fetchMock = vi.fn(async () =>
      jsonResponse({ message: 'ok', data: { id: CVR_FRIEND, name: 'Friend', isBlocked: true } })
    )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = cvrSignedIn()

    await adapter.getProfile(CVR_FRIEND, adapter.captureCommunityLease())
    now.mockReturnValue(30_999)
    await adapter.getBlocked(CVR_FRIEND, adapter.captureSocialLease())
    expect(fetchMock).toHaveBeenCalledOnce()
    now.mockReturnValue(31_000)
    await adapter.getBlocked(CVR_FRIEND, adapter.captureSocialLease())
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('never shares a failed read', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValue(jsonResponse({ id: VRC_FRIEND, displayName: 'Friend', note: '' }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = vrcSignedIn()

    await expect(adapter.readAccountNote(VRC_FRIEND, adapter.captureNoteLease())).rejects.toThrow()
    await expect(
      adapter.getProfile(VRC_FRIEND, adapter.captureCommunityLease())
    ).resolves.toMatchObject({ userId: VRC_FRIEND })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('profile reads tell a missing person from an unreadable reply', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('VRChat: a 404 is a missing person', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
    const adapter = vrcSignedIn()
    await expect(
      adapter.getProfile(VRC_FRIEND, adapter.captureCommunityLease())
    ).resolves.toBeNull()
  })

  it('VRChat: an unreadable or mismatched reply is a failed read', async () => {
    for (const reply of [{ weird: true }, { id: VRC_ME, displayName: 'Someone else' }]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(reply)))
      const adapter = vrcSignedIn()
      await expect(
        adapter.getProfile(VRC_FRIEND, adapter.captureCommunityLease())
      ).rejects.toBeInstanceOf(CommunityDataError)
    }
  })

  it('ChilloutVR: a 404 is a missing person and an unreadable reply is a failed read', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ message: 'ok', data: 'not-an-object' }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = cvrSignedIn()
    await expect(
      adapter.getProfile(CVR_FRIEND, adapter.captureCommunityLease())
    ).resolves.toBeNull()
    await expect(
      adapter.getProfile(CVR_FRIEND, adapter.captureCommunityLease())
    ).rejects.toBeInstanceOf(CommunityDataError)
  })
})
