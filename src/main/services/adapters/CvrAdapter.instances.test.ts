import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdapterEvent } from '@shared/types'
import { CvrAdapter } from './CvrAdapter'
import { ApiAdmissionController } from './ApiAdmissionController'
import { CVRAuthError } from './errors'
import { jsonResponse, instantAdmission } from './__testutils__/adapterTestKit'
import { FriendAlerts, type FriendAlert } from '../friendAlerts'
import {
  fakeStore,
  authPayload,
  envelope,
  creds,
  markSessionEstablishedForTest
} from './__testutils__/cvrAdapterTestKit'

describe('CvrAdapter', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('instance enrichment (VRX-59)', () => {
    // Minimal drivable socket (CvrPipeline.test pattern).
    type Listener = (...args: unknown[]) => void
    function drivableSocket(): {
      socket: { on: (e: string, l: Listener) => void; close: () => void; send: () => void }
      fire: (event: string, ...args: unknown[]) => void
    } {
      const listeners = new Map<string, Listener[]>()
      return {
        socket: {
          on: (event: string, listener: Listener) => {
            listeners.set(event, [...(listeners.get(event) ?? []), listener])
          },
          close: () => {},
          send: () => {}
        },
        fire: (event: string, ...args: unknown[]) => {
          for (const l of listeners.get(event) ?? []) l(...args)
        }
      }
    }

    // Instance tag via interpolation (design-token raw-color guard).
    const taggedName = `SunDown (#${816332})`
    const instanceDetail = {
      id: 'i_abc',
      name: taggedName,
      world: { id: 'wrld-real', name: 'SunDown', imageUrl: 'https://img.example/w.png' },
      currentPlayerCount: 5,
      instanceSettingPrivacy: 2 // friends (live-confirmed numeric)
    }

    const groupInstanceDetail = {
      ...instanceDetail,
      id: 'i_group',
      instanceSettingPrivacy: 'GroupPlus',
      group: { id: 'grp-real', name: 'CVR Group', image: 'https://img.example/g.png' }
    }

    function groupWireSnapshot(): Extract<AdapterEvent, { type: 'presence-snapshot' }> {
      return {
        type: 'presence-snapshot',
        platform: 'chilloutvr',
        entries: [
          {
            platformUserId: 'a1b2c3d4-0000-0000-0000-000000000001',
            presence: { state: 'in-game' },
            instance: {
              worldId: 'i_group',
              instanceId: 'i_group',
              worldName: taggedName,
              thumbnailUrl: null,
              type: 'group-plus',
              openness: 'friends-plus',
              isGroup: true,
              groupName: null,
              groupId: null,
              groupImageUrl: null,
              region: null,
              userCount: null
            }
          }
        ]
      }
    }

    function directPresenceHarness(adapter: CvrAdapter): {
      snapshots: Array<Extract<AdapterEvent, { type: 'presence-snapshot' }>>
      drive: { handlePipelineEvent: (event: AdapterEvent) => void }
    } {
      const snapshots: Array<Extract<AdapterEvent, { type: 'presence-snapshot' }>> = []
      const drive = adapter as unknown as {
        subscribers: Set<(event: AdapterEvent) => void>
        handlePipelineEvent: (event: AdapterEvent) => void
      }
      drive.subscribers.add((event) => {
        if (event.type === 'presence-snapshot') snapshots.push(event)
      })
      return { snapshots, drive }
    }

    it('stops queued instance enrichment on 429 without negative caching or an expiry burst', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(10_000)
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const starts: number[] = []
      const fetchMock = vi.fn().mockImplementation(() => {
        starts.push(Date.now())
        return Promise.resolve(
          starts.length === 1
            ? new Response(null, { status: 429, headers: { 'Retry-After': '60' } })
            : jsonResponse(envelope(instanceDetail))
        )
      })
      vi.stubGlobal('fetch', fetchMock)
      const admission = new ApiAdmissionController()
      const adapter = markSessionEstablishedForTest(
        new CvrAdapter(fakeStore({ username: 'u', accessKey: 'k' }), admission)
      )
      const { drive, snapshots } = directPresenceHarness(adapter)
      const base = groupWireSnapshot().entries[0]!
      const snapshot: Extract<AdapterEvent, { type: 'presence-snapshot' }> = {
        type: 'presence-snapshot',
        platform: 'chilloutvr',
        entries: Array.from({ length: 3 }, (_, i) => ({
          ...base,
          platformUserId: `user-${i}`,
          instance: { ...base.instance!, instanceId: `i_${i}` }
        }))
      }
      drive.handlePipelineEvent(snapshot)
      await vi.advanceTimersByTimeAsync(0)
      expect(starts).toEqual([10_000])
      expect(admission.pendingCount).toBe(0)
      const resolver = (
        adapter as unknown as { instanceResolver: { peek: (id: string) => unknown } }
      ).instanceResolver
      for (let i = 0; i < 3; i++) expect(resolver.peek(`i_${i}`)).toBeUndefined()
      for (let i = 0; i < 20; i++) drive.handlePipelineEvent(snapshot)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(starts).toEqual([10_000])
      expect(snapshots).toHaveLength(21)
      drive.handlePipelineEvent(snapshot)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(starts).toEqual([10_000, 70_000, 71_000, 72_000])
    })

    function stubHeldInstanceRefresh(): {
      requests: { count: number }
      release: (response: Response) => void
    } {
      let releaseRefresh!: (response: Response) => void
      const heldRefresh = new Promise<Response>((resolve) => {
        releaseRefresh = resolve
      })
      const requests = { count: 0 }
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          requests.count += 1
          return requests.count === 1
            ? Promise.resolve(jsonResponse(envelope(groupInstanceDetail)))
            : heldRefresh
        })
      )
      return { requests, release: releaseRefresh }
    }

    function expiringResolverClock(): () => void {
      let now = 10_000
      vi.spyOn(Date, 'now').mockImplementation(() => now)
      return () => {
        now += 5 * 60 * 1_000
      }
    }

    async function startResolvedGroupSnapshot(): Promise<{
      adapter: CvrAdapter
      snapshots: Array<Extract<AdapterEvent, { type: 'presence-snapshot' }>>
      drive: { handlePipelineEvent: (event: AdapterEvent) => void }
      snapshot: Extract<AdapterEvent, { type: 'presence-snapshot' }>
    }> {
      const adapter = new CvrAdapter(
        fakeStore({ username: 'u', accessKey: 'k' }),
        instantAdmission()
      )
      markSessionEstablishedForTest(adapter)
      const { snapshots, drive } = directPresenceHarness(adapter)
      const snapshot = groupWireSnapshot()
      drive.handlePipelineEvent(snapshot)
      await vi.waitFor(() => expect(snapshots).toHaveLength(2))
      return { adapter, snapshots, drive, snapshot }
    }

    function stubGroupInstanceSuccess(): void {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse(envelope(groupInstanceDetail))))
      )
    }

    it('dispatches getInstanceDetails interactively ahead of pipeline-driven default resolution', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(10_000)
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const dispatches: Array<{ path: string; at: number }> = []
      vi.stubGlobal(
        'fetch',
        vi.fn((url: RequestInfo | URL) => {
          const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          const path = new URL(href).pathname
          dispatches.push({ path, at: Date.now() })
          if (path === '/1/friends') {
            return Promise.resolve(jsonResponse({ message: 'ok', data: [] }))
          }
          return Promise.resolve(
            jsonResponse(
              envelope({
                ...instanceDetail,
                id: path.endsWith('/i_dialog') ? 'i_dialog' : 'i_pipeline'
              })
            )
          )
        })
      )
      const adapter = new CvrAdapter(
        fakeStore({ username: 'u', accessKey: 'k' }),
        instantAdmission((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
      )
      markSessionEstablishedForTest(adapter)
      const drive = adapter as unknown as {
        handlePipelineEvent: (event: AdapterEvent) => void
      }

      const blocker = adapter.getFriends()
      drive.handlePipelineEvent({
        type: 'presence-snapshot',
        platform: 'chilloutvr',
        entries: [
          {
            platformUserId: 'a1b2c3d4-0000-0000-0000-000000000001',
            presence: { state: 'in-game' },
            instance: {
              worldId: 'i_pipeline',
              instanceId: 'i_pipeline',
              worldName: taggedName,
              thumbnailUrl: null,
              type: 'public',
              openness: 'public',
              isGroup: false,
              groupName: null,
              groupId: null,
              groupImageUrl: null,

              region: null,
              userCount: null
            }
          }
        ]
      })
      const dialog = adapter.getInstanceDetails('i_dialog')

      await vi.advanceTimersByTimeAsync(0)
      expect(dispatches).toEqual([{ path: '/1/friends', at: 10_000 }])

      await vi.advanceTimersByTimeAsync(1_000)
      expect(dispatches[1]).toEqual({ path: '/1/instances/i_dialog', at: 11_000 })

      await vi.advanceTimersByTimeAsync(1_000)
      await expect(Promise.all([blocker, dialog])).resolves.toHaveLength(2)
      expect(dispatches).toEqual([
        { path: '/1/friends', at: 10_000 },
        { path: '/1/instances/i_dialog', at: 11_000 },
        { path: '/1/instances/i_pipeline', at: 12_000 }
      ])
    })

    it('dispatches getInstanceDetails interactively when the same id is queued by the pipeline', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(10_000)
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const dispatches: Array<{ path: string; at: number }> = []
      vi.stubGlobal(
        'fetch',
        vi.fn((url: RequestInfo | URL) => {
          const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          const path = new URL(href).pathname
          dispatches.push({ path, at: Date.now() })
          if (path === '/1/friends') {
            return Promise.resolve(jsonResponse({ message: 'ok', data: [] }))
          }
          return Promise.resolve(
            jsonResponse(
              envelope({
                ...instanceDetail,
                id: path.endsWith('/i_dialog') ? 'i_dialog' : 'i_ahead'
              })
            )
          )
        })
      )
      const adapter = new CvrAdapter(
        fakeStore({ username: 'u', accessKey: 'k' }),
        instantAdmission((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
      )
      markSessionEstablishedForTest(adapter)
      const drive = adapter as unknown as {
        handlePipelineEvent: (event: AdapterEvent) => void
      }

      const blocker = adapter.getFriends()
      drive.handlePipelineEvent({
        type: 'presence-snapshot',
        platform: 'chilloutvr',
        entries: ['i_ahead', 'i_dialog'].map((instanceId) => ({
          platformUserId: `user-${instanceId}`,
          presence: { state: 'in-game' as const },
          instance: {
            worldId: instanceId,
            instanceId,
            worldName: taggedName,
            thumbnailUrl: null,
            type: 'public' as const,
            openness: 'public' as const,
            isGroup: false,
            groupName: null,
            groupId: null,
            groupImageUrl: null,

            region: null,
            userCount: null
          }
        }))
      })
      const dialog = adapter.getInstanceDetails('i_dialog')

      await vi.advanceTimersByTimeAsync(0)
      expect(dispatches).toEqual([{ path: '/1/friends', at: 10_000 }])

      await vi.advanceTimersByTimeAsync(1_000)
      expect(dispatches[1]).toEqual({ path: '/1/instances/i_dialog', at: 11_000 })
      await expect(dialog).resolves.toMatchObject({ instanceId: 'i_dialog' })

      await vi.advanceTimersByTimeAsync(2_000)
      await expect(blocker).resolves.toEqual({ friends: [], completeness: 'complete' })
      expect(dispatches).toEqual([
        { path: '/1/friends', at: 10_000 },
        { path: '/1/instances/i_dialog', at: 11_000 },
        { path: '/1/instances/i_ahead', at: 12_000 },
        { path: '/1/instances/i_dialog', at: 13_000 }
      ])
    })

    it('re-emits an enriched presence-snapshot once the instance resolves (world id + clean name)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse(envelope(instanceDetail))))
      )
      const rig = drivableSocket()
      const adapter = new CvrAdapter(
        fakeStore({ username: 'u', accessKey: 'k' }),
        instantAdmission(),
        {
          socketFactory: () => rig.socket
        }
      )
      markSessionEstablishedForTest(adapter)
      const snapshots: Array<Extract<AdapterEvent, { type: 'presence-snapshot' }>> = []
      const unsub = adapter.subscribe((e) => {
        if (e.type === 'presence-snapshot') snapshots.push(e)
      })
      await new Promise((r) => setImmediate(r))
      rig.fire('open')
      rig.fire(
        'message',
        JSON.stringify({
          ResponseType: 10,
          Message: null,
          Data: [
            {
              Id: 'A1B2C3D4-0000-0000-0000-000000000001',
              IsOnline: true,
              Instance: { Id: 'i_abc', Name: taggedName, Privacy: 0 }
            }
          ]
        })
      )

      // Immediate snapshot carries the WIRE values (worldId = instance id;
      // worldName = the creator-set label, the UI's fallback until resolution —
      // FriendAlerts independently strips it from alert copy).
      expect(snapshots[0]!.entries[0]!.instance).toMatchObject({
        worldId: 'i_abc',
        worldName: taggedName
      })

      // The resolution lands → a re-emitted snapshot carries the TRUE world.
      await vi.waitFor(() => {
        const last = snapshots.at(-1)!
        expect(last.entries[0]!.instance).toMatchObject({
          worldId: 'wrld-real',
          worldName: 'SunDown',
          thumbnailUrl: 'https://img.example/w.png',
          userCount: 5
        })
      })
      // instanceId and WS-fresh privacy classification are untouched.
      expect(snapshots.at(-1)!.entries[0]!.instance).toMatchObject({
        instanceId: 'i_abc',
        type: 'public'
      })
      unsub()
    })

    it('enriched presence-snapshot populates group fields from the resolved detail (VRX-263)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse(envelope(groupInstanceDetail))))
      )
      const rig = drivableSocket()
      const adapter = new CvrAdapter(
        fakeStore({ username: 'u', accessKey: 'k' }),
        instantAdmission(),
        {
          socketFactory: () => rig.socket
        }
      )
      markSessionEstablishedForTest(adapter)
      const snapshots: Array<Extract<AdapterEvent, { type: 'presence-snapshot' }>> = []
      const unsub = adapter.subscribe((e) => {
        if (e.type === 'presence-snapshot') snapshots.push(e)
      })
      await new Promise((r) => setImmediate(r))
      rig.fire('open')
      rig.fire(
        'message',
        JSON.stringify({
          ResponseType: 10,
          Message: null,
          Data: [
            {
              Id: 'A1B2C3D4-0000-0000-0000-000000000001',
              IsOnline: true,
              Instance: { Id: 'i_group', Name: taggedName, Privacy: 7 }
            }
          ]
        })
      )

      // Immediate WS-built snapshot has no group identity.
      expect(snapshots[0]!.entries[0]!.instance).toMatchObject({
        groupId: null,
        groupName: null,
        groupImageUrl: null
      })

      // REST enrichment fills the group fields.
      await vi.waitFor(() => {
        expect(snapshots.at(-1)!.entries[0]!.instance?.worldId).toBe('wrld-real')
      })
      expect(snapshots.at(-1)!.entries[0]!.instance).toMatchObject({
        groupId: 'grp-real',
        groupName: 'CVR Group',
        groupImageUrl: 'https://img.example/g.png'
      })
      unsub()
    })

    it('retains same-instance enrichment while an expired resolver entry refreshes (VRX-265)', async () => {
      const expireResolver = expiringResolverClock()
      const refresh = stubHeldInstanceRefresh()
      const { snapshots, drive } = await startResolvedGroupSnapshot()

      // The resolver's success TTL is five minutes. Hold the refresh open so
      // this assertion can only pass if the adapter preserves its last-known
      // same-instance enrichment instead of briefly reverting to WS nulls.
      expireResolver()
      const refreshSnapshot = groupWireSnapshot()
      refreshSnapshot.entries[0]!.presence = { state: 'active' }
      refreshSnapshot.entries[0]!.instance = {
        ...refreshSnapshot.entries[0]!.instance!,
        type: 'friends',
        openness: 'friends',
        isGroup: false
      }
      drive.handlePipelineEvent(refreshSnapshot)
      expect(snapshots).toHaveLength(3)
      await vi.waitFor(() => {
        expect(refresh.requests.count).toBe(2)
      })

      expect(snapshots.at(-1)!.entries[0]!.presence.state).toBe('active')
      expect(snapshots.at(-1)!.entries[0]!.instance).toMatchObject({
        worldId: 'wrld-real',
        worldName: 'SunDown',
        thumbnailUrl: 'https://img.example/w.png',
        userCount: 5,
        groupId: 'grp-real',
        groupName: 'CVR Group',
        groupImageUrl: 'https://img.example/g.png',
        type: 'friends',
        openness: 'friends',
        isGroup: false
      })
      refresh.release(jsonResponse(envelope(groupInstanceDetail)))
      await vi.waitFor(() => expect(snapshots).toHaveLength(4))
    })

    it('drops retained enrichment when the TTL refresh fails (VRX-265)', async () => {
      const expireResolver = expiringResolverClock()
      let instanceRequests = 0
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          instanceRequests += 1
          return instanceRequests === 1
            ? Promise.resolve(jsonResponse(envelope(groupInstanceDetail)))
            : Promise.reject(new Error('offline'))
        })
      )
      const { snapshots, drive, snapshot } = await startResolvedGroupSnapshot()

      expireResolver()
      drive.handlePipelineEvent(snapshot)
      expect(snapshots.at(-1)!.entries[0]!.instance?.worldId).toBe('wrld-real')

      await vi.waitFor(() => expect(snapshots).toHaveLength(4))
      expect(snapshots.at(-1)!.entries[0]!.instance).toMatchObject({
        worldId: 'i_group',
        worldName: taggedName,
        thumbnailUrl: null,
        userCount: null,
        groupId: null,
        groupName: null,
        groupImageUrl: null
      })
    })

    it('keeps a newer interactive resolution when an older background refresh fails (VRX-265)', async () => {
      const expireResolver = expiringResolverClock()
      let rejectBackgroundRefresh!: (error: Error) => void
      const backgroundRefresh = new Promise<Response>((_resolve, reject) => {
        rejectBackgroundRefresh = reject
      })
      let instanceRequests = 0
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          instanceRequests += 1
          if (instanceRequests === 1) {
            return Promise.resolve(jsonResponse(envelope(groupInstanceDetail)))
          }
          if (instanceRequests === 2) return backgroundRefresh
          return Promise.resolve(
            jsonResponse(
              envelope({
                ...groupInstanceDetail,
                world: { id: 'wrld-newer', name: 'Newer World', imageUrl: null }
              })
            )
          )
        })
      )
      const { adapter, snapshots, drive, snapshot } = await startResolvedGroupSnapshot()

      expireResolver()
      drive.handlePipelineEvent(snapshot)
      await vi.waitFor(() => expect(instanceRequests).toBe(2))

      await expect(adapter.getInstanceDetails('i_group')).resolves.toMatchObject({
        worldId: 'wrld-newer',
        worldName: 'Newer World'
      })
      // Record the newer interactive cache value in the live snapshot before
      // the older background request resolves.
      drive.handlePipelineEvent(snapshot)
      expect(snapshots.at(-1)!.entries[0]!.instance).toMatchObject({
        worldId: 'wrld-newer',
        worldName: 'Newer World'
      })

      rejectBackgroundRefresh(new Error('offline'))

      await new Promise((resolve) => setImmediate(resolve))
      // The stale failure is deliberately silent: it must neither erase nor
      // re-emit over the newer interactive result.
      expect(snapshots).toHaveLength(4)
      expect(snapshots.at(-1)!.entries[0]!.instance).toMatchObject({
        worldId: 'wrld-newer',
        worldName: 'Newer World'
      })
    })

    it('uses an interactive cache value when an instance leaves before that lookup settles (VRX-265)', async () => {
      let rejectBackgroundRefresh!: (error: Error) => void
      const backgroundRefresh = new Promise<Response>((_resolve, reject) => {
        rejectBackgroundRefresh = reject
      })
      let releaseInteractive!: (response: Response) => void
      const interactiveLookup = new Promise<Response>((resolve) => {
        releaseInteractive = resolve
      })
      let instanceRequests = 0
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          instanceRequests += 1
          return instanceRequests === 1 ? backgroundRefresh : interactiveLookup
        })
      )
      const adapter = new CvrAdapter(
        fakeStore({ username: 'u', accessKey: 'k' }),
        instantAdmission()
      )
      markSessionEstablishedForTest(adapter)
      const { snapshots, drive } = directPresenceHarness(adapter)
      const snapshot = groupWireSnapshot()

      drive.handlePipelineEvent(snapshot)
      await vi.waitFor(() => expect(instanceRequests).toBe(1))
      const details = adapter.getInstanceDetails('i_group')
      await vi.waitFor(() => expect(instanceRequests).toBe(2))
      drive.handlePipelineEvent({ ...snapshot, entries: [] })

      releaseInteractive(
        jsonResponse(
          envelope({
            ...groupInstanceDetail,
            world: { id: 'wrld-interactive', name: 'Interactive World', imageUrl: null }
          })
        )
      )
      await expect(details).resolves.toMatchObject({
        worldId: 'wrld-interactive',
        worldName: 'Interactive World'
      })

      // The older background failure lands while the instance is absent and
      // overwrites the resolver cache with null. Re-entry must still prefer
      // the newer interactive answer.
      rejectBackgroundRefresh(new Error('offline'))
      await new Promise((resolve) => setImmediate(resolve))
      drive.handlePipelineEvent(snapshot)
      expect(snapshots.at(-1)!.entries[0]!.instance).toMatchObject({
        worldId: 'wrld-interactive',
        worldName: 'Interactive World'
      })
      drive.handlePipelineEvent(snapshot)
      expect(snapshots.at(-1)!.entries[0]!.instance).toMatchObject({
        worldId: 'wrld-interactive',
        worldName: 'Interactive World'
      })
    })

    it('prunes retained enrichment when an instance leaves the full snapshot (VRX-265)', async () => {
      const expireResolver = expiringResolverClock()
      const refresh = stubHeldInstanceRefresh()
      const { snapshots, drive, snapshot } = await startResolvedGroupSnapshot()

      expireResolver()
      drive.handlePipelineEvent({ ...snapshot, entries: [] })
      drive.handlePipelineEvent(snapshot)
      await vi.waitFor(() => expect(refresh.requests.count).toBe(2))

      expect(snapshots.at(-1)!.entries[0]!.instance?.worldId).toBe('i_group')
      refresh.release(jsonResponse(envelope(groupInstanceDetail)))
      await vi.waitFor(() =>
        expect(snapshots.at(-1)!.entries[0]!.instance?.worldId).toBe('wrld-real')
      )
    })

    it('clears retained enrichment at an account boundary (VRX-265)', async () => {
      const expireResolver = expiringResolverClock()
      stubGroupInstanceSuccess()
      const { adapter, snapshots, drive, snapshot } = await startResolvedGroupSnapshot()

      expireResolver()
      adapter.clearSession()
      drive.handlePipelineEvent(snapshot)

      expect(snapshots.at(-1)!.entries[0]!.instance?.worldId).toBe('i_group')
    })

    it('keeps opennessUnknown on the re-emitted snapshot after mergeResolved (unmapped WS privacy)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse(envelope(instanceDetail))))
      )
      const rig = drivableSocket()
      const adapter = new CvrAdapter(
        fakeStore({ username: 'u', accessKey: 'k' }),
        instantAdmission(),
        {
          socketFactory: () => rig.socket
        }
      )
      markSessionEstablishedForTest(adapter)
      const snapshots: Array<Extract<AdapterEvent, { type: 'presence-snapshot' }>> = []
      const unsub = adapter.subscribe((e) => {
        if (e.type === 'presence-snapshot') snapshots.push(e)
      })
      await new Promise((r) => setImmediate(r))
      rig.fire('open')
      rig.fire(
        'message',
        JSON.stringify({
          ResponseType: 10,
          Message: null,
          Data: [
            {
              Id: 'A1B2C3D4-0000-0000-0000-000000000001',
              IsOnline: true,
              // 8 is UNMAPPED: the wire parse degrades restrictive AND tags
              // opennessUnknown (VRX-240).
              Instance: { Id: 'i_abc', Name: taggedName, Privacy: 8 }
            }
          ]
        })
      )

      // Immediate snapshot carries the degraded+flagged wire parse.
      expect(snapshots[0]!.entries[0]!.instance).toMatchObject({
        type: 'owner-must-invite',
        opennessUnknown: true
      })

      // The resolution lands → the mergeResolved re-emit must STILL carry the
      // flag (mutation target: dropping it typechecks and used to stay green).
      await vi.waitFor(() => {
        expect(snapshots.at(-1)!.entries[0]!.instance?.worldId).toBe('wrld-real')
      })
      expect(snapshots.at(-1)!.entries[0]!.instance).toMatchObject({
        worldId: 'wrld-real',
        type: 'owner-must-invite',
        opennessUnknown: true
      })
      unsub()
    })

    it('rapid snapshots while a resolution is in flight produce ONE re-emit, not N (Sol High)', async () => {
      let releaseResolution!: (r: Response) => void
      const held = new Promise<Response>((resolve) => {
        releaseResolution = resolve
      })
      vi.stubGlobal(
        'fetch',
        vi.fn((url: RequestInfo | URL) => {
          const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          return href.endsWith('/friends')
            ? Promise.resolve(jsonResponse({ message: 'ok', data: [] }))
            : held
        })
      )
      const rig = drivableSocket()
      const adapter = new CvrAdapter(
        fakeStore({ username: 'u', accessKey: 'k' }),
        instantAdmission(),
        {
          socketFactory: () => rig.socket
        }
      )
      markSessionEstablishedForTest(adapter)
      const snapshots: AdapterEvent[] = []
      const unsub = adapter.subscribe((e) => {
        if (e.type === 'presence-snapshot') snapshots.push(e)
      })
      await new Promise((r) => setImmediate(r))
      rig.fire('open')
      const wsFrame = (): string =>
        JSON.stringify({
          ResponseType: 10,
          Message: null,
          Data: [
            {
              Id: 'A1B2C3D4-0000-0000-0000-000000000001',
              IsOnline: true,
              Instance: { Id: 'i_abc', Name: taggedName, Privacy: 0 }
            }
          ]
        })
      // THREE rapid snapshots while the same instance resolution is held open.
      rig.fire('message', wsFrame())
      rig.fire('message', wsFrame())
      rig.fire('message', wsFrame())
      expect(snapshots).toHaveLength(3) // pass-through emits, one per frame

      releaseResolution(jsonResponse(envelope(instanceDetail)))
      await vi.waitFor(() => {
        const last = snapshots.at(-1)! as Extract<AdapterEvent, { type: 'presence-snapshot' }>
        expect(last.entries[0]!.instance?.worldId).toBe('wrld-real')
      })
      // Exactly ONE enrichment re-emit (4 total) — not one per queued snapshot.
      await new Promise((r) => setTimeout(r, 20))
      expect(snapshots).toHaveLength(4)
      unsub()
    })

    it('cannot re-emit an old snapshot between reconnect live and the fresh baseline', async () => {
      let releaseResolution!: (response: Response) => void
      const held = new Promise<Response>((resolve) => {
        releaseResolution = resolve
      })
      vi.stubGlobal(
        'fetch',
        vi.fn(() => held)
      )
      const adapter = new CvrAdapter(
        fakeStore({ username: 'u', accessKey: 'k' }),
        instantAdmission(),
        {
          socketFactory: () => ({ on: () => {}, close: () => {} })
        }
      )
      const alerts: FriendAlert[] = []
      const friendAlerts = new FriendAlerts({
        notify: (alert) => alerts.push(alert),
        clock: () => 0,
        isEnabled: () => true,
        resolveName: () => 'Known Friend'
      })
      const snapshots: AdapterEvent[] = []
      const unsub = adapter.subscribe((event) => {
        friendAlerts.consume(event)
        if (event.type === 'presence-snapshot') snapshots.push(event)
      })
      const drive = adapter as unknown as {
        handlePipelineEvent: (event: AdapterEvent) => void
      }
      const oldSnapshot: AdapterEvent = {
        type: 'presence-snapshot',
        platform: 'chilloutvr',
        entries: [
          {
            platformUserId: 'a1b2c3d4-0000-0000-0000-000000000001',
            presence: { state: 'in-game' },
            instance: {
              worldId: 'i_old',
              instanceId: 'i_old',
              worldName: taggedName,
              thumbnailUrl: null,
              type: 'public',
              openness: 'public',
              isGroup: false,
              groupName: null,
              groupId: null,
              groupImageUrl: null,

              region: null,
              userCount: null
            }
          }
        ]
      }

      drive.handlePipelineEvent({
        type: 'connection',
        platform: 'chilloutvr',
        health: 'live'
      })
      drive.handlePipelineEvent(oldSnapshot)
      drive.handlePipelineEvent({
        type: 'connection',
        platform: 'chilloutvr',
        health: 'reconnecting'
      })
      drive.handlePipelineEvent({
        type: 'connection',
        platform: 'chilloutvr',
        health: 'live'
      })

      // The old lookup settles inside the vulnerable live→new-snapshot gap.
      releaseResolution(jsonResponse(envelope(instanceDetail)))
      await new Promise((resolve) => setImmediate(resolve))
      expect(snapshots).toHaveLength(1)

      drive.handlePipelineEvent({
        type: 'presence-snapshot',
        platform: 'chilloutvr',
        entries: [
          {
            platformUserId: 'a1b2c3d4-0000-0000-0000-000000000002',
            presence: { state: 'in-game' },
            instance: null
          }
        ]
      })
      expect(snapshots).toHaveLength(2)
      expect(alerts).toEqual([])
      unsub()
    })

    it('resolution failure leaves wire values standing (no re-emit, no throw)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse({ message: 'nope' }, { status: 404 })))
      )
      const rig = drivableSocket()
      const adapter = new CvrAdapter(
        fakeStore({ username: 'u', accessKey: 'k' }),
        instantAdmission(),
        {
          socketFactory: () => rig.socket
        }
      )
      markSessionEstablishedForTest(adapter)
      const snapshots: AdapterEvent[] = []
      const unsub = adapter.subscribe((e) => {
        if (e.type === 'presence-snapshot') snapshots.push(e)
      })
      await new Promise((r) => setImmediate(r))
      rig.fire('open')
      rig.fire(
        'message',
        JSON.stringify({
          ResponseType: 10,
          Message: null,
          Data: [
            {
              Id: 'A1B2C3D4-0000-0000-0000-000000000001',
              IsOnline: true,
              Instance: { Id: 'i_dead', Name: 'Hidden', Privacy: 7 }
            }
          ]
        })
      )
      // Give the (failing) resolution time to settle; still exactly ONE snapshot.
      await new Promise((r) => setTimeout(r, 20))
      expect(snapshots).toHaveLength(1)
      // Wire label stays as the UI fallback when resolution fails (VRX-59 UX).
      expect(
        (snapshots[0] as Extract<AdapterEvent, { type: 'presence-snapshot' }>).entries[0]!.instance
          ?.worldName
      ).toBe('Hidden')
      unsub()
    })

    it('expired credentials during background enrichment invalidate auth without crashing the roster path', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse({ message: 'denied' }, { status: 401 })))
      )
      const store = fakeStore({ username: 'u', accessKey: 'expired' })
      const adapter = new CvrAdapter(store, instantAdmission(), {
        socketFactory: () => ({ on: () => {}, close: () => {} })
      })
      markSessionEstablishedForTest(adapter)
      const events: AdapterEvent[] = []
      const unsub = adapter.subscribe((event) => events.push(event))
      const drive = adapter as unknown as {
        handlePipelineEvent: (event: AdapterEvent) => void
      }

      drive.handlePipelineEvent({
        type: 'presence-snapshot',
        platform: 'chilloutvr',
        entries: [
          {
            platformUserId: 'a1b2c3d4-0000-0000-0000-000000000001',
            presence: { state: 'in-game' },
            instance: {
              worldId: 'i_expired',
              instanceId: 'i_expired',
              worldName: 'Wire fallback',
              thumbnailUrl: null,
              type: 'public',
              openness: 'public',
              isGroup: false,
              groupName: null,
              groupId: null,
              groupImageUrl: null,

              region: null,
              userCount: null
            }
          }
        ]
      })

      // The roster snapshot still arrives immediately; the async 401 becomes an
      // auth boundary instead of an unhandled enrichment rejection/cache miss.
      expect(events.filter((event) => event.type === 'presence-snapshot')).toHaveLength(1)
      await vi.waitFor(() =>
        expect(events).toContainEqual({ type: 'auth-invalidated', platform: 'chilloutvr' })
      )
      expect(events.filter((event) => event.type === 'presence-snapshot')).toHaveLength(1)
      expect(store.deleted).toBe(1)
      expect((await adapter.getAuthStatus()).state).toBe('unauthenticated')
      const resolver = (
        adapter as unknown as {
          instanceResolver: { peek: (id: string) => unknown }
        }
      ).instanceResolver
      expect(resolver.peek('i_expired')).toBeUndefined()
      unsub()
    })

    it('fires an unresolved in-game alert without the creator-set instance label', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse({ message: 'not found' }, { status: 404 })))
      )
      const adapter = new CvrAdapter(
        fakeStore({ username: 'u', accessKey: 'k' }),
        instantAdmission(),
        {
          socketFactory: () => ({ on: () => {}, close: () => {} })
        }
      )
      const alerts: FriendAlert[] = []
      const engine = new FriendAlerts({
        notify: (alert) => alerts.push(alert),
        clock: () => 0,
        isEnabled: () => true,
        resolveName: () => 'Known Friend'
      })
      const unsub = adapter.subscribe((event) => engine.consume(event))
      const drive = adapter as unknown as {
        handlePipelineEvent: (event: AdapterEvent) => void
      }
      drive.handlePipelineEvent({
        type: 'presence-snapshot',
        platform: 'chilloutvr',
        entries: [
          {
            platformUserId: 'a1b2c3d4-0000-0000-0000-000000000001',
            presence: { state: 'in-game' },
            instance: null
          }
        ]
      })
      drive.handlePipelineEvent({
        type: 'presence-snapshot',
        platform: 'chilloutvr',
        entries: [
          {
            platformUserId: 'a1b2c3d4-0000-0000-0000-000000000001',
            presence: { state: 'offline' },
            instance: null
          }
        ]
      })
      drive.handlePipelineEvent({
        type: 'presence-snapshot',
        platform: 'chilloutvr',
        entries: [
          {
            platformUserId: 'a1b2c3d4-0000-0000-0000-000000000001',
            presence: { state: 'in-game' },
            instance: {
              worldId: 'i_unresolved',
              instanceId: 'i_unresolved',
              worldName: "Bono's Movie Night",
              thumbnailUrl: null,
              type: 'public',
              openness: 'public',
              isGroup: false,
              groupName: null,
              groupId: null,
              groupImageUrl: null,

              region: null,
              userCount: null
            }
          }
        ]
      })

      expect(alerts).toContainEqual(expect.objectContaining({ type: 'in-game', worldName: null }))
      unsub()
    })

    it('a late resolution cannot re-emit the pre-quarantine roster after auth dies (VRX-195 guard)', async () => {
      // fetch: the instance resolution is HELD until after the 401 clears the
      // session — then released. No re-emit may follow.
      let releaseResolution!: (r: Response) => void
      const held = new Promise<Response>((resolve) => {
        releaseResolution = resolve
      })
      vi.stubGlobal(
        'fetch',
        vi.fn((url: RequestInfo | URL) => {
          const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          if (u.includes('/instances/')) return held
          // getFriends path → 401 (kills the session, VRX-195)
          return Promise.resolve(jsonResponse({ message: 'denied' }, { status: 401 }))
        })
      )
      const rig = drivableSocket()
      const adapter = new CvrAdapter(
        fakeStore({ username: 'u', accessKey: 'k' }),
        instantAdmission(),
        {
          socketFactory: () => rig.socket
        }
      )
      markSessionEstablishedForTest(adapter)
      const events: AdapterEvent[] = []
      const unsub = adapter.subscribe((e) => events.push(e))
      await new Promise((r) => setImmediate(r))
      rig.fire('open')
      rig.fire(
        'message',
        JSON.stringify({
          ResponseType: 10,
          Message: null,
          Data: [
            {
              Id: 'A1B2C3D4-0000-0000-0000-000000000001',
              IsOnline: true,
              Instance: { Id: 'i_abc', Name: taggedName, Privacy: 0 }
            }
          ]
        })
      )
      const snapshotsBefore = events.filter((e) => e.type === 'presence-snapshot').length
      expect(snapshotsBefore).toBe(1)

      // The session dies on the data path (401 → clearSession + auth-invalidated).
      await expect(adapter.getFriends()).rejects.toThrow()
      expect(events.some((e) => e.type === 'auth-invalidated')).toBe(true)

      // NOW the held resolution lands — it must not resurrect the old roster.
      releaseResolution(jsonResponse(envelope(instanceDetail)))
      await new Promise((r) => setTimeout(r, 20))
      const snapshotsAfter = events.filter((e) => e.type === 'presence-snapshot').length
      expect(snapshotsAfter).toBe(snapshotsBefore) // no post-quarantine re-emit
      unsub()
    })

    it('adoptSession A→B drops a late A resolution and a late A socket event everywhere', async () => {
      let releaseAccountAResolution!: (response: Response) => void
      const heldResolution = new Promise<Response>((resolve) => {
        releaseAccountAResolution = resolve
      })
      const fetchMock = vi.fn((url: RequestInfo | URL) => {
        const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        if (href.endsWith('/friends')) {
          return Promise.resolve(jsonResponse({ message: 'ok', data: [] }))
        }
        if (href.includes('/instances/')) return heldResolution
        return Promise.resolve(
          jsonResponse(envelope(authPayload({ username: 'account-b', accessKey: 'key-b' })))
        )
      })
      vi.stubGlobal('fetch', fetchMock)

      const rigs = [drivableSocket(), drivableSocket()]
      let dial = 0
      const alerts: FriendAlert[] = []
      const friendAlerts = new FriendAlerts({
        notify: (alert) => alerts.push(alert),
        clock: () => 0,
        isEnabled: () => true,
        resolveName: () => 'Account A Friend'
      })
      const events: AdapterEvent[] = []
      const adapter = new CvrAdapter(
        fakeStore({ username: 'account-a', accessKey: 'key-a' }),
        instantAdmission(),
        {
          socketFactory: () => rigs[dial++]!.socket,
          onSessionBoundary: () => friendAlerts.resetPlatform('chilloutvr')
        }
      )
      markSessionEstablishedForTest(adapter)
      const unsub = adapter.subscribe((event) => {
        events.push(event)
        friendAlerts.consume(event)
      })
      await vi.waitFor(() => expect(dial).toBe(1))
      rigs[0]!.fire('open')
      rigs[0]!.fire(
        'message',
        JSON.stringify({
          ResponseType: 10,
          Message: null,
          Data: [
            {
              Id: 'A1B2C3D4-0000-0000-0000-000000000001',
              IsOnline: true,
              Instance: { Id: 'i_account_a', Name: 'Account A World', Privacy: 0 }
            }
          ]
        })
      )
      await vi.waitFor(() => {
        const requestedAccountAInstance = fetchMock.mock.calls.some(([url]) => {
          const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          return href.includes('/instances/i_account_a')
        })
        expect(requestedAccountAInstance).toBe(true)
      })

      events.length = 0
      expect(await adapter.login(creds)).toEqual({ ok: true })
      await vi.waitFor(() => expect(dial).toBe(2))

      releaseAccountAResolution(jsonResponse(envelope(instanceDetail)))
      rigs[0]!.fire(
        'message',
        JSON.stringify({
          ResponseType: 10,
          Message: null,
          Data: [
            {
              Id: 'A1B2C3D4-0000-0000-0000-000000000001',
              IsOnline: true,
              Instance: null
            }
          ]
        })
      )
      await new Promise((resolve) => setImmediate(resolve))

      expect(events.filter((event) => event.type === 'presence-snapshot')).toEqual([])
      expect(alerts).toEqual([])
      const engineState = friendAlerts as unknown as {
        presence: Map<string, Map<string, unknown>>
      }
      expect(engineState.presence.get('chilloutvr')?.size ?? 0).toBe(0)
      const resolver = (
        adapter as unknown as {
          instanceResolver: { peek: (id: string) => unknown }
        }
      ).instanceResolver
      expect(resolver.peek('i_account_a')).toBeUndefined()
      unsub()
    })

    it('getInstanceDetails maps the resolved detail to a full InstanceInfo', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse(envelope(instanceDetail))))
      )
      const adapter = new CvrAdapter(
        fakeStore({ username: 'u', accessKey: 'k' }),
        instantAdmission()
      )
      markSessionEstablishedForTest(adapter)
      const info = await adapter.getInstanceDetails('i_abc')
      expect(info).toEqual({
        worldId: 'wrld-real',
        instanceId: 'i_abc',
        worldName: 'SunDown',
        thumbnailUrl: 'https://img.example/w.png',
        type: 'friends', // privacy 2 via parseCvrPrivacy
        openness: 'friends',
        isGroup: false,
        groupName: null,
        groupId: null,
        groupImageUrl: null,

        region: null,
        userCount: 5
      })
    })

    it('getInstanceDetails populates group fields from a resolved group object (VRX-263)', async () => {
      stubGroupInstanceSuccess()
      const adapter = new CvrAdapter(
        fakeStore({ username: 'u', accessKey: 'k' }),
        instantAdmission()
      )
      markSessionEstablishedForTest(adapter)
      const info = await adapter.getInstanceDetails('i_group')
      expect(info).toMatchObject({
        type: 'friends-of-members',
        isGroup: true,
        groupId: 'grp-real',
        groupName: 'CVR Group',
        groupImageUrl: 'https://img.example/g.png'
      })
    })

    it('getInstanceDetails tags an unmapped privacy value after restrictive degradation', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(jsonResponse(envelope({ ...instanceDetail, instanceSettingPrivacy: 8 })))
        )
      )
      const adapter = new CvrAdapter(
        fakeStore({ username: 'u', accessKey: 'k' }),
        instantAdmission()
      )
      markSessionEstablishedForTest(adapter)

      await expect(adapter.getInstanceDetails('i_future')).resolves.toMatchObject({
        type: 'owner-must-invite',
        openness: 'invite',
        opennessUnknown: true
      })
    })

    it('rejects obsolete instance resolution and permits a fresh account-B lookup', async () => {
      let releaseAccountA!: (response: Response) => void
      const heldAccountA = new Promise<Response>((resolve) => {
        releaseAccountA = resolve
      })
      let instanceCalls = 0
      vi.stubGlobal(
        'fetch',
        vi.fn((url: RequestInfo | URL) => {
          const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          if (href.includes('/instances/')) {
            instanceCalls += 1
            if (instanceCalls === 1) return heldAccountA
            return Promise.resolve(
              jsonResponse(
                envelope({
                  ...instanceDetail,
                  world: { id: 'world-b', name: 'Account B World', imageUrl: null }
                })
              )
            )
          }
          return Promise.resolve(
            jsonResponse(envelope(authPayload({ username: 'account-b', accessKey: 'key-b' })))
          )
        })
      )
      const adapter = new CvrAdapter(
        fakeStore({ username: 'account-a', accessKey: 'key-a' }),
        instantAdmission()
      )
      markSessionEstablishedForTest(adapter)

      const details = adapter.getInstanceDetails('i_abc')
      await vi.waitFor(() => expect(instanceCalls).toBe(1))
      expect(await adapter.login(creds)).toEqual({ ok: true })
      releaseAccountA(jsonResponse(envelope(instanceDetail)))

      await expect(details).rejects.toThrow('Session ended')
      expect(instanceCalls).toBe(1)
      await expect(adapter.getInstanceDetails('i_abc')).resolves.toMatchObject({
        worldId: 'world-b',
        worldName: 'Account B World'
      })
      expect(instanceCalls).toBe(2)
    })

    it('getInstanceDetails rejects (does not return null) when unresolvable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse({ message: 'gone' }, { status: 404 })))
      )
      const adapter = new CvrAdapter(
        fakeStore({ username: 'u', accessKey: 'k' }),
        instantAdmission()
      )
      markSessionEstablishedForTest(adapter)
      await expect(adapter.getInstanceDetails('i_gone')).rejects.toThrow(
        'private or could not be resolved'
      )
    })

    it('getInstanceDetails invalidates an expired session instead of reporting the instance private', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse({ message: 'denied' }, { status: 401 })))
      )
      const store = fakeStore({ username: 'u', accessKey: 'expired' })
      const adapter = new CvrAdapter(store, instantAdmission(), {
        socketFactory: () => ({ on: () => {}, close: () => {} })
      })
      markSessionEstablishedForTest(adapter)
      const events: AdapterEvent[] = []
      const unsub = adapter.subscribe((event) => events.push(event))

      await expect(adapter.getInstanceDetails('i_expired')).rejects.toBeInstanceOf(CVRAuthError)
      expect(events).toContainEqual({ type: 'auth-invalidated', platform: 'chilloutvr' })
      expect(store.deleted).toBe(1)
      unsub()
    })
  })
})
