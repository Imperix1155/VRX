import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AvatarRequestLease } from './adapters/RequestLease'
import {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_MAX_BODY_BYTES,
  AvatarCache,
  type AvatarRenditionMaker
} from './avatarCache'
import { ImageDiskStore } from './imageDiskStore'

const VRC_IMAGE_URL = 'https://api.vrchat.cloud/api/1/image/file_0000/1/256'
const CDN_URL = 'https://d348imysud55la.cloudfront.net/thumbnails/file_0000.256.png'
const CVR_URL = 'https://files.chilloutvr.net/file/ugc-image/0000.png'
const ORIGINAL = 'data:image/png;base64,YXZhdGFy' // "avatar"
const SMALL = 'data:image/jpeg;base64,c21hbGw=' // "small"

function imageLease(): AvatarRequestLease {
  const controller = new AbortController()
  return {
    generation: 1,
    signal: controller.signal,
    isCurrent: () => true,
    getCookie: () => 'auth=authcookie_test'
  }
}

function imageFetch(): ReturnType<typeof vi.fn<typeof fetch>> {
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

const shrink: AvatarRenditionMaker = () => ({
  contentType: 'image/jpeg',
  bytes: Buffer.from('small')
})

let root: string
const disk = (): ImageDiskStore =>
  new ImageDiskStore({
    directory: join(root, 'image-cache'),
    allowedMimeTypes: AVATAR_ALLOWED_MIME_TYPES,
    maxBodyBytes: AVATAR_MAX_BODY_BYTES
  })

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'vrx-avatar-rendition-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('AvatarCache avatar rendition', () => {
  it('keeps only the small copy for an avatar request and the original for others', async () => {
    const fetchFn = imageFetch()
    const maker = vi.fn(shrink)
    const cache = new AvatarCache({ fetchFn, makeAvatarRendition: maker })

    await expect(cache.get(CVR_URL, 'avatar')).resolves.toBe(SMALL)
    await expect(cache.get(CVR_URL, 'avatar')).resolves.toBe(SMALL)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(maker).toHaveBeenCalledTimes(1)
    expect(cache.retainedBytes).toBe(SMALL.length)

    await expect(cache.get(CVR_URL)).resolves.toBe(ORIGINAL)
    expect(maker).toHaveBeenCalledTimes(1)
  })

  it('falls back to the original when no smaller copy is made or the maker throws', async () => {
    const declined = new AvatarCache({ fetchFn: imageFetch(), makeAvatarRendition: () => null })
    await expect(declined.get(CVR_URL, 'avatar')).resolves.toBe(ORIGINAL)

    const failing = new AvatarCache({
      fetchFn: imageFetch(),
      makeAvatarRendition: () => {
        throw new Error('decode failed')
      }
    })
    await expect(failing.get(CVR_URL, 'avatar')).resolves.toBe(ORIGINAL)

    const unset = new AvatarCache({ fetchFn: imageFetch() })
    await expect(unset.get(CVR_URL, 'avatar')).resolves.toBe(ORIGINAL)
  })

  it('stores the small copy on disk and shows it after a relaunch without a request', async () => {
    const store = disk()
    await new AvatarCache({
      fetchFn: imageFetch(),
      vrcSessionProvider: () => imageLease(),
      diskStore: store,
      makeAvatarRendition: shrink
    }).get(VRC_IMAGE_URL, 'avatar')
    await vi.waitFor(() => expect(store.size).toBe(1))

    const fetchFn = imageFetch()
    const maker = vi.fn(shrink)
    const relaunched = new AvatarCache({
      fetchFn,
      vrcSessionProvider: () => null,
      diskStore: disk(),
      makeAvatarRendition: maker
    })
    await expect(relaunched.get(VRC_IMAGE_URL, 'avatar')).resolves.toBe(SMALL)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(maker).not.toHaveBeenCalled()
  })

  it('builds the small copy from an original an older build stored, without a request', async () => {
    const store = disk()
    await new AvatarCache({
      fetchFn: imageFetch(),
      vrcSessionProvider: () => imageLease(),
      diskStore: store
    }).get(VRC_IMAGE_URL)
    await vi.waitFor(() => expect(store.size).toBe(1))

    const fetchFn = imageFetch()
    const upgradedStore = disk()
    const upgraded = new AvatarCache({
      fetchFn,
      vrcSessionProvider: () => imageLease(),
      diskStore: upgradedStore,
      makeAvatarRendition: shrink
    })
    await expect(upgraded.get(VRC_IMAGE_URL, 'avatar')).resolves.toBe(SMALL)
    expect(fetchFn).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(upgradedStore.size).toBe(2))
  })

  it('forgets avatar copies on an explicit VRChat sign-out', async () => {
    const store = disk()
    const cache = new AvatarCache({
      fetchFn: imageFetch(),
      vrcSessionProvider: () => imageLease(),
      diskStore: store,
      makeAvatarRendition: shrink
    })
    await cache.get(VRC_IMAGE_URL, 'avatar')
    await vi.waitFor(() => expect(store.size).toBe(1))
    await cache.clearStoredImages()
    expect(cache.retainedBytes).toBe(0)
    expect(store.size).toBe(0)
  })
})
