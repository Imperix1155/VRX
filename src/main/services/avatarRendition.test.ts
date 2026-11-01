import { describe, expect, it, vi } from 'vitest'
import {
  AVATAR_RENDITION_EDGE,
  PICTURE_RENDITION_KEEP_BYTES,
  PICTURE_RENDITION_MAX_WIDTH,
  createAvatarRenditionMaker,
  createPictureRenditionMaker,
  type RenditionImage
} from './avatarRendition'

const LARGE = Buffer.alloc(64 * 1024)

function fakeImage(
  width: number,
  height: number,
  options: { alpha?: number; empty?: boolean; encoded?: number } = {}
): RenditionImage & { resize: ReturnType<typeof vi.fn> } {
  const image = {
    isEmpty: () => options.empty === true,
    getSize: () => ({ width, height }),
    resize: vi.fn((size: { width: number; height: number }) =>
      fakeImage(size.width, size.height, { ...options, empty: false })
    ),
    toBitmap: () => {
      const bitmap = Buffer.alloc(width * height * 4, 255)
      if (options.alpha !== undefined) bitmap[3] = options.alpha
      return bitmap
    },
    toPNG: () => Buffer.alloc(options.encoded ?? 100, 1),
    toJPEG: () => Buffer.alloc(options.encoded ?? 50, 2)
  }
  return image
}

describe('createAvatarRenditionMaker', () => {
  it('scales the short side to the rendition edge and keeps the aspect ratio', () => {
    const source = fakeImage(1024, 768)
    const make = createAvatarRenditionMaker(() => source)
    const rendition = make({ contentType: 'image/png', bytes: LARGE })
    expect(source.resize).toHaveBeenCalledWith({
      width: 256,
      height: AVATAR_RENDITION_EDGE,
      quality: 'good'
    })
    expect(rendition).toEqual({ contentType: 'image/jpeg', bytes: Buffer.alloc(50, 2) })
  })

  it('keeps transparency as PNG', () => {
    const make = createAvatarRenditionMaker(() => fakeImage(1024, 1024, { alpha: 0 }))
    expect(make({ contentType: 'image/png', bytes: LARGE })?.contentType).toBe('image/png')
  })

  it('scales a large picture even when its file is small', () => {
    const make = createAvatarRenditionMaker(() => fakeImage(1024, 1024, { encoded: 2048 }))
    const rendition = make({ contentType: 'image/png', bytes: Buffer.alloc(1024) })
    expect(rendition?.contentType).toBe('image/jpeg')
  })

  it('keeps the original for small pictures, other formats and failures', () => {
    const decode = vi.fn(() => fakeImage(1024, 1024))
    const make = createAvatarRenditionMaker(decode)
    expect(make({ contentType: 'image/gif', bytes: LARGE })).toBeNull()
    expect(make({ contentType: 'image/webp', bytes: LARGE })).toBeNull()
    expect(decode).not.toHaveBeenCalled()

    expect(
      createAvatarRenditionMaker(() => fakeImage(AVATAR_RENDITION_EDGE, 900))({
        contentType: 'image/png',
        bytes: LARGE
      })
    ).toBeNull()
    expect(
      createAvatarRenditionMaker(() => fakeImage(1024, 1024, { empty: true }))({
        contentType: 'image/jpeg',
        bytes: LARGE
      })
    ).toBeNull()
    expect(
      createAvatarRenditionMaker(() => fakeImage(1024, 1024, { encoded: 0 }))({
        contentType: 'image/png',
        bytes: LARGE
      })
    ).toBeNull()
  })
})

describe('createPictureRenditionMaker', () => {
  const BIG_FILE = Buffer.alloc(PICTURE_RENDITION_KEEP_BYTES + 1)

  it('narrows a picture wider than the limit and keeps the aspect ratio', () => {
    const source = fakeImage(2048, 1536)
    const rendition = createPictureRenditionMaker(() => source)({
      contentType: 'image/png',
      bytes: Buffer.alloc(1024)
    })
    expect(source.resize).toHaveBeenCalledWith({
      width: PICTURE_RENDITION_MAX_WIDTH,
      height: 1080,
      quality: 'good'
    })
    expect(rendition?.contentType).toBe('image/jpeg')
  })

  it('re-encodes a big file at its own size when that makes it smaller', () => {
    const source = fakeImage(1200, 900)
    const rendition = createPictureRenditionMaker(() => source)({
      contentType: 'image/png',
      bytes: BIG_FILE
    })
    expect(source.resize).not.toHaveBeenCalled()
    expect(rendition).toEqual({ contentType: 'image/jpeg', bytes: Buffer.alloc(50, 2) })
  })

  it('keeps transparency as PNG', () => {
    const make = createPictureRenditionMaker(() => fakeImage(2048, 1024, { alpha: 0 }))
    expect(make({ contentType: 'image/png', bytes: BIG_FILE })?.contentType).toBe('image/png')
  })

  it('keeps the original for small files, other formats, no saving and failures', () => {
    const decode = vi.fn(() => fakeImage(800, 600))
    const make = createPictureRenditionMaker(decode)
    expect(make({ contentType: 'image/png', bytes: Buffer.alloc(1024) })).toBeNull()
    expect(make({ contentType: 'image/webp', bytes: BIG_FILE })).toBeNull()
    expect(
      createPictureRenditionMaker(() => fakeImage(800, 600, { encoded: BIG_FILE.byteLength }))({
        contentType: 'image/jpeg',
        bytes: BIG_FILE
      })
    ).toBeNull()
    expect(
      createPictureRenditionMaker(() => fakeImage(800, 600, { empty: true }))({
        contentType: 'image/png',
        bytes: BIG_FILE
      })
    ).toBeNull()
    expect(
      createPictureRenditionMaker(() => fakeImage(2048, 1536, { encoded: 0 }))({
        contentType: 'image/png',
        bytes: BIG_FILE
      })
    ).toBeNull()
  })
})
