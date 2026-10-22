import { describe, expect, it, vi } from 'vitest'
import {
  AVATAR_RENDITION_EDGE,
  AVATAR_RENDITION_MIN_SOURCE_BYTES,
  createAvatarRenditionMaker,
  type RenditionImage
} from './avatarRendition'

const LARGE = Buffer.alloc(AVATAR_RENDITION_MIN_SOURCE_BYTES + 1)

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

  it('keeps the original for small files, small pictures, other formats and failures', () => {
    const decode = vi.fn(() => fakeImage(1024, 1024))
    const make = createAvatarRenditionMaker(decode)
    expect(make({ contentType: 'image/png', bytes: Buffer.alloc(10) })).toBeNull()
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
      createAvatarRenditionMaker(() => fakeImage(1024, 1024, { encoded: LARGE.byteLength }))({
        contentType: 'image/png',
        bytes: LARGE
      })
    ).toBeNull()
  })
})
