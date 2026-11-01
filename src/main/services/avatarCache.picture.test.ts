import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiAdmissionController } from './adapters/ApiAdmissionController'
import type { AvatarRequestLease } from './adapters/RequestLease'
import {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_MAX_BODY_BYTES,
  AvatarCache,
  PICTURE_REFUSED_MS,
  PICTURE_REFUSED_STREAK_LIMIT,
  vrcFullPictureUrl,
  type AvatarRenditionMaker
} from './avatarCache'
import { ImageDiskStore } from './imageDiskStore'

const THUMB = (n: number): string => `https://api.vrchat.cloud/api/1/image/file_000${n}/3/256`
const FULL = (n: number): string => `https://api.vrchat.cloud/api/1/file/file_000${n}/3/file`
const CDN = 'https://cdn.example.net/signed'
const CVR_URL = 'https://files.chilloutvr.net/file/ugc-image/0000.png'
const SHARP = 'data:image/jpeg;base64,c2hhcnA=' // "sharp"
const THUMB_DATA = 'data:image/jpeg;base64,dGh1bWI=' // "thumb"

function lease(): AvatarRequestLease {
  return {
    generation: 1,
    signal: new AbortController().signal,
    isCurrent: () => true,
    getCookie: () => 'auth=authcookie_test'
  }
}

/** Each URL's answer: a body served behind VRChat's redirect, or a status. */
type Answer = { body: string } | { status: number } | { tooBig: true } | { type: string }

function fetchWith(answers: Record<string, Answer>): ReturnType<typeof vi.fn<typeof fetch>> {
  let target = ''
  return vi.fn<typeof fetch>().mockImplementation((input) => {
    const url = input instanceof Request ? input.url : input.toString()
    if (url !== CDN) {
      const answer = answers[url]
      if (answer === undefined) return Promise.resolve(new Response(null, { status: 404 }))
      if ('status' in answer) return Promise.resolve(new Response(null, { status: answer.status }))
      target = url
      return Promise.resolve(new Response(null, { status: 302, headers: { Location: CDN } }))
    }
    const answer = answers[target] ?? { status: 404 }
    if ('status' in answer) return Promise.resolve(new Response(null, { status: answer.status }))
    if ('tooBig' in answer)
      return Promise.resolve(
        new Response('x', {
          headers: {
            'Content-Type': 'image/png',
            'Content-Length': String(AVATAR_MAX_BODY_BYTES + 1)
          }
        })
      )
    if ('type' in answer)
      return Promise.resolve(new Response('x', { headers: { 'Content-Type': answer.type } }))
    const body = 'body' in answer ? answer.body : ''
    return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'image/png' } }))
  })
}

/** The rendition re-encodes as JPEG and keeps the body, so tests can tell sources apart. */
const reencode: AvatarRenditionMaker = (image) => ({
  contentType: 'image/jpeg',
  bytes: image.bytes
})

function urls(fetchFn: ReturnType<typeof vi.fn<typeof fetch>>): string[] {
  return fetchFn.mock.calls.map(([input]) =>
    input instanceof Request ? input.url : input.toString()
  )
}

/** VRChat's one-per-second spacing is tested elsewhere; skip the wait here. */
const fastLane = (): ApiAdmissionController => new ApiAdmissionController({ minimumIntervalMs: 0 })

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'vrx-picture-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('vrcFullPictureUrl', () => {
  it('maps a sized VRChat thumbnail to its full picture', () => {
    expect(vrcFullPictureUrl(THUMB(1))).toBe(FULL(1))
    expect(vrcFullPictureUrl('https://api.vrchat.cloud/api/1/image/file_ab-12/7/128/')).toBe(
      'https://api.vrchat.cloud/api/1/file/file_ab-12/7/file'
    )
  })

  it('leaves every other URL alone', () => {
    expect(vrcFullPictureUrl(FULL(1))).toBeNull()
    expect(vrcFullPictureUrl('https://api.vrchat.cloud/api/1/image/file_1/3/1024')).toBeNull()
    expect(vrcFullPictureUrl(CVR_URL)).toBeNull()
    expect(vrcFullPictureUrl('https://api.vrchat.cloud/api/1/image/file_1/3/256?x=1')).toBeNull()
    expect(vrcFullPictureUrl('https://evil.example/api/1/image/file_1/3/256')).toBeNull()
    expect(vrcFullPictureUrl('https://api.vrchat.cloud/api/1/image/../1/3/256')).toBeNull()
  })
})

describe('AvatarCache.getPicture', () => {
  it('asks VRChat for the full picture instead of the thumbnail: one request, no thumbnail', async () => {
    const fetchFn = fetchWith({ [FULL(1)]: { body: 'sharp' } })
    const cache = new AvatarCache({
      fetchFn,
      apiAdmission: fastLane(),
      vrcSessionProvider: lease,
      makePictureRendition: reencode
    })

    await expect(cache.getPicture(THUMB(1))).resolves.toBe(SHARP)
    await expect(cache.getPicture(THUMB(1))).resolves.toBe(SHARP)
    expect(urls(fetchFn)).toEqual([FULL(1), CDN])
  })

  it('fetches other hosts as they are, as a picture rendition', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('sharp', { headers: { 'Content-Type': 'image/png' } }))
    const cache = new AvatarCache({ fetchFn, makePictureRendition: reencode })
    await expect(cache.getPicture(CVR_URL)).resolves.toBe(SHARP)
    expect(urls(fetchFn)).toEqual([CVR_URL])
  })

  it.each<[string, Answer]>([
    ['too big', { tooBig: true }],
    ['not an image', { type: 'text/html' }],
    ['a 404', { status: 404 }]
  ])('uses the thumbnail when VRChat refuses the full picture (%s)', async (_label, answer) => {
    const fetchFn = fetchWith({ [FULL(1)]: answer, [THUMB(1)]: { body: 'thumb' } })
    const cache = new AvatarCache({
      fetchFn,
      apiAdmission: fastLane(),
      vrcSessionProvider: lease,
      makePictureRendition: reencode
    })

    await expect(cache.getPicture(THUMB(1))).resolves.toBe(THUMB_DATA)
    const first = urls(fetchFn).length
    // The refusal is remembered: the next ask goes straight to the (cached) thumbnail.
    await expect(cache.getPicture(THUMB(1))).resolves.toBe(THUMB_DATA)
    expect(urls(fetchFn)).toHaveLength(first)
    expect(urls(fetchFn).filter((url) => url === FULL(1))).toHaveLength(1)
  })

  it.each([429, 401, 503])('requests nothing more after a passing failure (%i)', async (status) => {
    const fetchFn = fetchWith({ [FULL(1)]: { status }, [THUMB(1)]: { body: 'thumb' } })
    const cache = new AvatarCache({
      fetchFn,
      apiAdmission: fastLane(),
      vrcSessionProvider: lease,
      makePictureRendition: reencode
    })
    await expect(cache.getPicture(THUMB(1))).resolves.toBeNull()
    expect(urls(fetchFn)).toEqual([FULL(1)])
  })

  it('goes straight to thumbnails for a while after several refusals in a row', async () => {
    let now = 1_000
    const answers: Record<string, Answer> = {}
    for (let n = 1; n <= PICTURE_REFUSED_STREAK_LIMIT + 1; n++) {
      answers[FULL(n)] = { type: 'application/octet-stream' }
      answers[THUMB(n)] = { body: 'thumb' }
    }
    const fetchFn = fetchWith(answers)
    const cache = new AvatarCache({
      fetchFn,
      now: () => now,
      apiAdmission: fastLane(),
      vrcSessionProvider: lease,
      makePictureRendition: reencode
    })
    for (let n = 1; n <= PICTURE_REFUSED_STREAK_LIMIT; n++) {
      await expect(cache.getPicture(THUMB(n))).resolves.toBe(THUMB_DATA)
    }
    const next = PICTURE_REFUSED_STREAK_LIMIT + 1
    await expect(cache.getPicture(THUMB(next))).resolves.toBe(THUMB_DATA)
    expect(urls(fetchFn)).not.toContain(FULL(next))

    now += PICTURE_REFUSED_MS + 1
    answers[FULL(next + 1)] = { body: 'sharp' }
    await expect(cache.getPicture(THUMB(next + 1))).resolves.toBe(SHARP)
  })

  it('keeps showing a full picture it already has during the pause', async () => {
    const answers: Record<string, Answer> = { [FULL(9)]: { body: 'sharp' } }
    for (let n = 1; n <= PICTURE_REFUSED_STREAK_LIMIT; n++) {
      answers[FULL(n)] = { type: 'application/octet-stream' }
      answers[THUMB(n)] = { body: 'thumb' }
    }
    const fetchFn = fetchWith(answers)
    const cache = new AvatarCache({
      fetchFn,
      apiAdmission: fastLane(),
      vrcSessionProvider: lease,
      makePictureRendition: reencode
    })
    await expect(cache.getPicture(THUMB(9))).resolves.toBe(SHARP)
    for (let n = 1; n <= PICTURE_REFUSED_STREAK_LIMIT; n++) await cache.getPicture(THUMB(n))
    const before = urls(fetchFn).length
    await expect(cache.getPicture(THUMB(9))).resolves.toBe(SHARP)
    expect(urls(fetchFn)).toHaveLength(before)
    expect(urls(fetchFn)).not.toContain(THUMB(9))
  })

  it('a session boundary forgets refusals', async () => {
    const answers: Record<string, Answer> = {
      [FULL(1)]: { status: 404 },
      [THUMB(1)]: { body: 'thumb' }
    }
    const fetchFn = fetchWith(answers)
    const cache = new AvatarCache({
      fetchFn,
      apiAdmission: fastLane(),
      vrcSessionProvider: lease,
      makePictureRendition: reencode
    })
    await expect(cache.getPicture(THUMB(1))).resolves.toBe(THUMB_DATA)
    cache.clearNegativeEntries()
    answers[FULL(1)] = { body: 'sharp' }
    await expect(cache.getPicture(THUMB(1))).resolves.toBe(SHARP)
  })

  it('stores the sharp copy on disk and shows it after a relaunch without a request', async () => {
    const disk = (): ImageDiskStore =>
      new ImageDiskStore({
        directory: join(root, 'image-cache'),
        allowedMimeTypes: AVATAR_ALLOWED_MIME_TYPES,
        maxBodyBytes: AVATAR_MAX_BODY_BYTES
      })
    const store = disk()
    await new AvatarCache({
      fetchFn: fetchWith({ [FULL(1)]: { body: 'sharp' } }),
      apiAdmission: fastLane(),
      vrcSessionProvider: lease,
      diskStore: store,
      makePictureRendition: reencode
    }).getPicture(THUMB(1))
    await vi.waitFor(() => expect(store.size).toBe(1))

    const fetchFn = fetchWith({})
    const relaunched = new AvatarCache({
      fetchFn,
      vrcSessionProvider: () => null,
      diskStore: disk(),
      makePictureRendition: reencode
    })
    await expect(relaunched.getPicture(THUMB(1))).resolves.toBe(SHARP)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('before the session is ready, shows a stored thumbnail and sends nothing', async () => {
    const disk = (): ImageDiskStore =>
      new ImageDiskStore({
        directory: join(root, 'image-cache'),
        allowedMimeTypes: AVATAR_ALLOWED_MIME_TYPES,
        maxBodyBytes: AVATAR_MAX_BODY_BYTES
      })
    const store = disk()
    // An older build stored the thumbnail as an original.
    await new AvatarCache({
      fetchFn: fetchWith({ [THUMB(1)]: { body: 'thumb' } }),
      apiAdmission: fastLane(),
      vrcSessionProvider: lease,
      diskStore: store
    }).get(THUMB(1))
    await vi.waitFor(() => expect(store.size).toBe(1))

    const fetchFn = fetchWith({})
    const waitingStore = disk()
    const waiting = new AvatarCache({
      fetchFn,
      vrcSessionProvider: () => null,
      diskStore: waitingStore,
      makePictureRendition: reencode
    })
    await expect(waiting.getPicture(THUMB(1))).resolves.toBe(THUMB_DATA)
    expect(fetchFn).not.toHaveBeenCalled()
    // The picture copy built from the stored thumbnail is saved in the background.
    await vi.waitFor(() => expect(waitingStore.size).toBe(2))
  })
})
