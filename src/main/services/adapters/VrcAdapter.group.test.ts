import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdapterEvent } from '@shared/types'
import { VrcAdapter, type VrcCredentialStore } from './VrcAdapter'
import { jsonResponse, noopSleep } from './__testutils__/adapterTestKit'

function fakeStore(initial?: string): VrcCredentialStore & { saved: string[]; deleted: number } {
  let value = initial
  const store = {
    saved: [] as string[],
    deleted: 0,
    load: () => value,
    save: (cookie: string, accountId: string | null) => {
      void accountId
      value = cookie
      store.saved.push(cookie)
    },
    delete: () => {
      value = undefined
      store.deleted++
    }
  }
  return store
}

describe('VrcAdapter group enrichment (VRX-260)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('getFriends snapshots cached group metadata and kicks a group-metadata event for uncached groups', async () => {
    const groupId = 'grp_x'
    const worldId = 'wrld_group'
    const location = `${worldId}:inst~group(${groupId})~groupAccessType(plus)`
    const groupMeta = { name: 'Pixel Pals', iconUrl: 'https://example.com/pals.png' }

    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      if (href.endsWith('/auth/user')) {
        return Promise.resolve(
          jsonResponse({
            id: 'usr_self',
            displayName: 'Self',
            onlineFriends: ['usr_friend'],
            activeFriends: [],
            offlineFriends: []
          })
        )
      }
      if (href.includes('/auth/user/friends')) {
        return Promise.resolve(
          jsonResponse(
            href.includes('offline=true')
              ? []
              : [
                  {
                    id: 'usr_friend',
                    displayName: 'Friend',
                    currentAvatarThumbnailImageUrl: null,
                    status: 'active',
                    statusDescription: null,
                    tags: [],
                    location
                  }
                ]
          )
        )
      }
      if (href.includes(`/worlds/${worldId}`)) {
        return Promise.resolve(jsonResponse({ name: 'Group World', thumbnailImageUrl: null }))
      }
      if (href.includes(`/groups/${groupId}`)) {
        return Promise.resolve(jsonResponse(groupMeta))
      }
      return Promise.reject(new Error(`Unexpected URL: ${href}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    const events: AdapterEvent[] = []
    const adapter = new VrcAdapter(fakeStore('auth=x'), noopSleep)
    const unsubscribe = adapter.subscribe((event) => events.push(event))

    try {
      // First call kicks the resolution; roster returns parser-null groupName.
      const first = await adapter.getFriends()
      expect(first.friends).toHaveLength(1)
      expect(first.friends[0]!.instance!.groupId).toBe(groupId)
      expect(first.friends[0]!.instance!.groupName).toBeNull()

      // Background resolution emits a narrow group-metadata event.
      await vi.waitFor(() => expect(events.some((e) => e.type === 'group-metadata')).toBe(true))
      const metaEvent = events.find((e) => e.type === 'group-metadata')
      expect(metaEvent).toMatchObject({
        type: 'group-metadata',
        platform: 'vrchat',
        groupId,
        groupName: groupMeta.name,
        groupImageUrl: groupMeta.iconUrl
      })

      // Applying the metadata to the cache yields the enriched roster.
      const { applyFriendEvent } = await import('../../../renderer/src/utils/applyFriendEvent')
      const enriched = applyFriendEvent(first.friends, metaEvent!)
      expect(enriched[0]!.instance!.groupName).toBe(groupMeta.name)
      expect(enriched[0]!.instance!.groupImageUrl).toBe(groupMeta.iconUrl)

      // A second getFriends snapshot-patches from the resolver cache.
      const second = await adapter.getFriends()
      expect(second.friends[0]!.instance!.groupName).toBe(groupMeta.name)
      expect(second.friends[0]!.instance!.groupImageUrl).toBe(groupMeta.iconUrl)
    } finally {
      unsubscribe()
    }
  })
})
