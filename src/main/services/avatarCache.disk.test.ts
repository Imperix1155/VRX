import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AvatarRequestLease } from './adapters/RequestLease'
import { AVATAR_ALLOWED_MIME_TYPES, AVATAR_MAX_BODY_BYTES, AvatarCache } from './avatarCache'
import { ImageDiskStore } from './imageDiskStore'

const VRC_IMAGE_URL = 'https://api.vrchat.cloud/api/1/image/file_0000/1/256'
const CDN_URL = 'https://d348imysud55la.cloudfront.net/thumbnails/file_0000.256.png'
const CVR_URL = 'https://files.chilloutvr.net/file/ugc-image/0000.png'
const PICTURE = 'data:image/png;base64,YXZhdGFy' // "avatar"

function imageLease(controller = new AbortController()): AvatarRequestLease {
  return {
    generation: 1,
    signal: controller.signal,
    isCurrent: () => !controller.signal.aborted,
    getCookie: () => 'auth=authcookie_test'
  }
}

function vrchatFetch(): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi
    .fn<typeof fetch>()
    .mockImplementation((input) =>
      Promise.resolve(
        (input instanceof Request ? input.url : input.toString()) === VRC_IMAGE_URL
          ? new Response(null, { status: 302, headers: { Location: CDN_URL } })
          : new Response('avatar', { headers: { 'Content-Type': 'image/png' } })
      )
    )
}

let root: string
const disk = (): ImageDiskStore =>
  new ImageDiskStore({
    directory: join(root, 'image-cache'),
    allowedMimeTypes: AVATAR_ALLOWED_MIME_TYPES,
    maxBodyBytes: AVATAR_MAX_BODY_BYTES
  })

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'vrx-avatar-disk-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('AvatarCache disk tier', () => {
  it('shows a VRChat picture from disk after a relaunch without any request', async () => {
    const firstStore = disk()
    const first = new AvatarCache({
      fetchFn: vrchatFetch(),
      vrcSessionProvider: () => imageLease(),
      diskStore: firstStore
    })
    await expect(first.get(VRC_IMAGE_URL)).resolves.toBe(PICTURE)
    await vi.waitFor(async () => expect(firstStore.size).toBe(1))

    const fetchFn = vrchatFetch()
    const relaunched = new AvatarCache({
      fetchFn,
      vrcSessionProvider: () => imageLease(),
      diskStore: disk()
    })
    await expect(relaunched.get(VRC_IMAGE_URL)).resolves.toBe(PICTURE)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('serves a stored picture before the VRChat session is ready, but never fetches then', async () => {
    const store = disk()
    await new AvatarCache({
      fetchFn: vrchatFetch(),
      vrcSessionProvider: () => imageLease(),
      diskStore: store
    }).get(VRC_IMAGE_URL)
    await vi.waitFor(() => expect(store.size).toBe(1))

    const fetchFn = vrchatFetch()
    const restoring = new AvatarCache({
      fetchFn,
      vrcSessionProvider: () => null,
      diskStore: disk()
    })
    await expect(restoring.get(VRC_IMAGE_URL)).resolves.toBe(PICTURE)
    await expect(
      restoring.get('https://api.vrchat.cloud/api/1/image/file_9999/1/256')
    ).resolves.toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('stores only API-host pictures, not CDN-direct ones', async () => {
    const store = disk()
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('avatar', { headers: { 'Content-Type': 'image/png' } }))
    const cache = new AvatarCache({ fetchFn, diskStore: store })
    await expect(cache.get(CVR_URL)).resolves.toBe(PICTURE)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(store.size).toBe(0)
  })

  it('does not store a picture whose session ended mid-request', async () => {
    const store = disk()
    const controller = new AbortController()
    let release!: (response: Response) => void
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: CDN_URL } }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve
          })
      )
    const cache = new AvatarCache({
      fetchFn,
      vrcSessionProvider: () => imageLease(controller),
      diskStore: store
    })
    const pending = cache.get(VRC_IMAGE_URL)
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2))
    controller.abort()
    release(new Response('avatar', { headers: { 'Content-Type': 'image/png' } }))
    await expect(pending).resolves.toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(store.size).toBe(0)
  })

  it('forgets stored VRChat pictures on sign-out, in memory and on disk', async () => {
    const store = disk()
    const fetchFn = vrchatFetch()
    const cache = new AvatarCache({
      fetchFn,
      vrcSessionProvider: () => imageLease(),
      diskStore: store
    })
    await cache.get(VRC_IMAGE_URL)
    await cache.get(CVR_URL)
    await vi.waitFor(() => expect(store.size).toBe(1))
    fetchFn.mockClear()

    await cache.clearStoredImages()
    expect(store.size).toBe(0)
    expect(await disk().read(VRC_IMAGE_URL)).toBeNull()
    await expect(cache.get(CVR_URL)).resolves.toBe(PICTURE)
    expect(fetchFn).not.toHaveBeenCalled()
    await expect(cache.get(VRC_IMAGE_URL)).resolves.toBe(PICTURE)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})
