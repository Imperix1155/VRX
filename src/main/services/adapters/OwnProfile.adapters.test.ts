import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VrcCredentialStore } from './VrcAdapter'
import { VrcAdapter } from './VrcAdapter'
import type { CVRCredentials } from './CvrApiClient'
import type { CvrCredentialStore } from './CvrAdapter'
import { CvrAdapter } from './CvrAdapter'
import { OwnProfileDataError } from './OwnProfileAdapter'
import { AuthError, CVRRateLimitError, RateLimitError } from './errors'
import {
  instantAdmission,
  jsonResponse,
  markVrcSessionEstablished
} from './__testutils__/adapterTestKit'

const VRC_ME = 'usr_12345678-1234-1234-1234-123456789abc'
const CVR_ME = '3a1661f1-3eeb-426e-92ec-1b2f08e609b5'

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
  Object.assign(adapter as unknown as { validated: boolean; accountId: string }, {
    validated: true,
    accountId: CVR_ME
  })
  return adapter
}

const vrcUser = {
  id: VRC_ME,
  displayName: 'Synthetic',
  bio: 'Hello there',
  pronouns: 'they/them',
  status: 'ask me',
  statusDescription: 'Busy building'
}

describe('VrcAdapter own profile', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reads the four editable fields from GET /users/{me}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(vrcUser))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = vrcSignedIn()

    await expect(adapter.getOwnProfile(adapter.captureOwnProfileLease())).resolves.toEqual({
      platform: 'vrchat',
      bio: 'Hello there',
      pronouns: 'they/them',
      status: 'ask-me',
      statusText: 'Busy building'
    })
    const [url, options] = fetchMock.mock.calls[0]!
    expect(url).toBe(`https://api.vrchat.cloud/api/1/users/${encodeURIComponent(VRC_ME)}`)
    expect(options).toMatchObject({ method: 'GET' })
  })

  it('refuses a reply about someone else or with a changed field type', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ ...vrcUser, id: 'usr_other' }))
        .mockResolvedValueOnce(jsonResponse({ ...vrcUser, bio: { text: 'x' } }))
    )
    const adapter = vrcSignedIn()
    for (let i = 0; i < 2; i++) {
      await expect(adapter.getOwnProfile(adapter.captureOwnProfileLease())).rejects.toBeInstanceOf(
        OwnProfileDataError
      )
    }
  })

  it('saves only the changed fields in one PUT, in VRChat words, and never retries it', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ...vrcUser, status: 'busy', bio: 'New bio' }))
      .mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = vrcSignedIn()

    const saved = await adapter.saveOwnProfile(
      { bio: 'New bio', status: 'dnd' },
      adapter.captureOwnProfileLease()
    )
    expect(saved).toMatchObject({ bio: 'New bio', status: 'dnd' })
    const [url, options] = fetchMock.mock.calls[0]!
    expect(url).toBe(`https://api.vrchat.cloud/api/1/users/${encodeURIComponent(VRC_ME)}`)
    expect(options).toMatchObject({ method: 'PUT', redirect: 'error' })
    expect(options.headers).toMatchObject({
      Cookie: 'auth=synthetic',
      'Content-Type': 'application/json'
    })
    expect(JSON.parse(String(options.body))).toEqual({ bio: 'New bio', status: 'busy' })

    await expect(
      adapter.saveOwnProfile({ statusText: 'x' }, adapter.captureOwnProfileLease())
    ).rejects.toBeInstanceOf(RateLimitError)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('maps every status both ways', async () => {
    const sent: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sent.push((JSON.parse(init.body as string) as { status: unknown }).status)
        return jsonResponse(vrcUser)
      })
    )
    const adapter = vrcSignedIn()
    for (const status of ['join-me', 'online', 'ask-me', 'dnd'] as const) {
      await adapter.saveOwnProfile({ status }, adapter.captureOwnProfileLease())
    }
    expect(sent).toEqual(['join me', 'active', 'ask me', 'busy'])
  })

  it('a data-path 401 on save invalidates the session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    const adapter = vrcSignedIn()
    const events: string[] = []
    adapter.subscribe((event) => events.push(event.type))
    await expect(
      adapter.saveOwnProfile({ bio: 'x' }, adapter.captureOwnProfileLease())
    ).rejects.toBeInstanceOf(AuthError)
    expect(events).toContain('auth-invalidated')
  })

  it('needs a durable session to capture a lease', () => {
    const adapter = new VrcAdapter(
      { load: () => 'auth=synthetic', save: () => {}, delete: () => {} },
      instantAdmission()
    )
    expect(() => adapter.captureOwnProfileLease()).toThrow()
  })
})

describe('CvrAdapter own profile', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reads the bio and pronouns from GET /users/{me}; no status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        message: null,
        data: {
          id: CVR_ME.toUpperCase(),
          name: 'Synthetic',
          profileBio: ' Hi ',
          profilePronouns: null
        }
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = cvrSignedIn()

    await expect(adapter.getOwnProfile(adapter.captureOwnProfileLease())).resolves.toEqual({
      platform: 'chilloutvr',
      bio: 'Hi',
      pronouns: '',
      status: null,
      statusText: null
    })
    expect(fetchMock.mock.calls[0]![0]).toBe(`https://api.abinteractive.net/1/users/${CVR_ME}`)
  })

  it('sends one multipart form per changed field to /users/self, never retried', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'Bio updated', data: null }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Pronouns updated', data: null }))
      .mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = cvrSignedIn()

    await expect(
      adapter.saveOwnProfile({ bio: 'New', pronouns: 'she/her' }, adapter.captureOwnProfileLease())
    ).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const forms = fetchMock.mock.calls.map(([url, options]) => {
      expect(url).toBe('https://api.abinteractive.net/1/users/self')
      expect(options).toMatchObject({ method: 'POST', redirect: 'error' })
      expect(options.headers).toMatchObject({ Username: 'cvr-user', AccessKey: 'cvr-access-key' })
      // fetch sets the multipart boundary itself.
      expect(options.headers['Content-Type']).toBeUndefined()
      return Object.fromEntries((options.body as FormData).entries())
    })
    expect(forms).toEqual([{ ProfileBio: 'New' }, { ProfilePronouns: 'she/her' }])

    await expect(
      adapter.saveOwnProfile({ bio: 'Again' }, adapter.captureOwnProfileLease())
    ).rejects.toBeInstanceOf(CVRRateLimitError)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('stops after the first failed field', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = cvrSignedIn()
    await expect(
      adapter.saveOwnProfile({ bio: 'New', pronouns: 'x' }, adapter.captureOwnProfileLease())
    ).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
