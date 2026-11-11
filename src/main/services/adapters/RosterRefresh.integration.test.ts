import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdapterEvent, Platform } from '@shared/types'
import type { FriendRoster } from './IPlatformAdapter'
import { CvrAdapter } from './CvrAdapter'
import { VrcAdapter } from './VrcAdapter'
import type { AppStatusService } from '../appStatus'
import { createFriendRosterReader } from '../friendRoster'
import { LocationAuthority } from '../locationAuthority'
import {
  instantAdmission,
  jsonResponse,
  markVrcSessionEstablished
} from './__testutils__/adapterTestKit'

interface Fixture {
  adapter: CvrAdapter | VrcAdapter
  event(): void
  /** The socket opens, as the adapter and its subscribers see it. */
  goLive(): void
}

function fixture(platform: Platform, live?: { captureRosterRevision: () => number }): Fixture {
  const connected: AdapterEvent = { type: 'connection', platform, health: 'live' }
  if (platform === 'chilloutvr') {
    const adapter = new CvrAdapter(
      {
        load: () => ({ username: 'fixture', accessKey: 'fixture' }),
        save: () => {},
        delete: () => {}
      },
      instantAdmission(),
      live
    )
    Object.assign(adapter, { validated: true })
    const drive = adapter as unknown as { handlePipelineEvent(event: AdapterEvent): void }
    return {
      adapter,
      event: () => drive.handlePipelineEvent({ type: 'roster-changed', platform }),
      goLive: () => drive.handlePipelineEvent(connected)
    }
  }
  const adapter = new VrcAdapter(
    { load: () => 'auth=fixture', save: () => {}, delete: () => {} },
    instantAdmission(),
    live
  )
  markVrcSessionEstablished(adapter)
  const pipeline = (
    adapter as unknown as { createPipeline(): { emit(event: AdapterEvent): void } }
  ).createPipeline()
  // A socket on its way, as at launch: the read starts from its own probe.
  Object.assign(adapter, { pipeline })
  const goLive = (): void => pipeline.emit(connected)
  return { adapter, event: goLive, goLive }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe.each(['vrchat', 'chilloutvr'] as const)('%s roster event coalescing', (platform) => {
  it('bounds an event storm to one follow-up per run and publishes each result to its callers', async () => {
    let releaseFirst!: () => void
    let releaseLast!: () => void
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const last = new Promise<void>((resolve) => {
      releaseLast = resolve
    })
    let snapshots = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (platform === 'chilloutvr' || url.endsWith('/auth/user')) {
        snapshots++
        if (snapshots === 1) await first
        if (snapshots === 2) await last
      }
      const name = ['First', 'Final'][snapshots - 1] ?? 'Later'
      if (platform === 'chilloutvr')
        return jsonResponse({
          message: 'ok',
          data: [
            { id: 'a1b2c3d4-0000-0000-0000-000000000001', name, imageUrl: null, categories: [] }
          ]
        })
      if (url.endsWith('/auth/user'))
        return jsonResponse({ onlineFriends: [], activeFriends: [], offlineFriends: [] })
      return jsonResponse(
        url.includes('offline=true') ? [] : [{ id: 'usr_fixture', displayName: name }]
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const { adapter, event } = fixture(platform)
    const request = adapter.getFriends()
    await vi.waitFor(() => expect(snapshots).toBe(1))
    const callers = [request]
    for (let i = 0; i < 50; i++) {
      event()
      callers.push(adapter.getFriends())
    }
    releaseFirst()
    await vi.waitFor(() => expect(snapshots).toBe(2))
    // The final read is already out, so its answer may miss these changes:
    // callers from here on share one more run after it.
    const later: Promise<FriendRoster>[] = []
    for (let i = 0; i < 50; i++) {
      event()
      later.push(adapter.getFriends())
    }
    releaseLast()
    const results = await Promise.all(callers)
    expect(results.every((result) => result === results[0])).toBe(true)
    expect(results[0]?.friends[0]?.displayName).toBe('Final')
    const laterResults = await Promise.all(later)
    expect(laterResults.every((result) => result === laterResults[0])).toBe(true)
    expect(laterResults[0]?.friends[0]?.displayName).toBe('Later')
    expect(fetchMock).toHaveBeenCalledTimes(platform === 'chilloutvr' ? 3 : 9)
    await adapter.getFriends()
    expect(snapshots).toBe(4)
  })

  it('reads once when the event lands before the first request is sent', async () => {
    let snapshots = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (platform === 'chilloutvr')
        return jsonResponse({
          message: 'ok',
          data: [
            {
              id: 'a1b2c3d4-0000-0000-0000-000000000001',
              name: `Read ${++snapshots}`,
              imageUrl: null,
              categories: []
            }
          ]
        })
      if (url.endsWith('/auth/user')) {
        snapshots++
        return jsonResponse({ onlineFriends: [], activeFriends: [], offlineFriends: [] })
      }
      return jsonResponse(
        url.includes('offline=true') ? [] : [{ id: 'usr_fixture', displayName: 'Read' }]
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const { adapter, event } = fixture(platform)
    const request = adapter.getFriends()
    // Nothing has been asked yet, so this read already covers the change.
    event()
    expect(adapter.getFriends()).toBe(request)
    expect((await request).friends).toHaveLength(1)
    expect(snapshots).toBe(1)
  })

  it('lets joins through after a launch whose socket opens before the first request', async () => {
    const id = platform === 'chilloutvr' ? 'a1b2c3d4-0000-0000-0000-000000000001' : 'usr_fixture'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (platform === 'chilloutvr')
          return jsonResponse({
            message: 'ok',
            data: [{ id, name: 'Friend', imageUrl: null, categories: [] }]
          })
        if (url.endsWith('/auth/user'))
          return jsonResponse({ onlineFriends: [], activeFriends: [], offlineFriends: [] })
        return jsonResponse(url.includes('offline=true') ? [] : [{ id, displayName: 'Friend' }])
      })
    )
    const authority = new LocationAuthority()
    const { adapter, goLive } = fixture(platform, {
      captureRosterRevision: () => authority.captureSeedRevision(platform)
    })
    const read = createFriendRosterReader(new Map([[platform, adapter]]), authority, {
      recordReconcile: () => undefined
    } as unknown as AppStatusService)
    const launch = read(platform)
    // The socket opens while the read still waits its turn. The window's own
    // read for the reconnect shares that one run, so nothing reads twice.
    goLive()
    authority.consume({ type: 'connection', platform, health: 'live' })
    const reconnect = read(platform)
    await Promise.all([launch, reconnect])
    // The one read counts as the catch-up: main knows where friends are.
    expect(authority.resolve(platform, id)).toMatchObject({ ok: true })
  })

  it('drops pending follow-up when an active roster rate limits', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetchMock = vi.fn(async () => {
      await held
      return new Response(null, { status: 429, headers: { 'Retry-After': '60' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { adapter, event } = fixture(platform)
    const request = adapter.getFriends().catch((error: unknown) => error)
    for (let i = 0; i < 50; i++) event()
    release()
    expect(await request).toBeInstanceOf(Error)
    expect(fetchMock).toHaveBeenCalledOnce()
    await expect(adapter.getFriends()).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
