import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RenditionImage } from './avatarRendition'
import {
  APP_BACKGROUND_MAX_EDGE,
  APP_BACKGROUND_MAX_SOURCE_BYTES,
  AppBackgroundStore,
  orientBitmap,
  readJpegOrientation,
  readPictureSize,
  sniffPictureType
} from './appBackground'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33)
  Buffer.from(PNG_SIGNATURE).copy(bytes, 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'latin1')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

/** SOI, an APP0 segment, then a baseline frame header. */
function jpeg(width: number, height: number): Buffer {
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]
  const sof = [0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff]
  return Buffer.from([0xff, 0xd8, ...app0, 0xff, ...sof, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9])
}

interface FakeImage extends RenditionImage {
  resized: { width: number; height: number } | null
}

function fakeImage(
  width: number,
  height: number,
  options: { empty?: boolean; opaque?: boolean } = {}
): FakeImage {
  const image: FakeImage = {
    resized: null,
    isEmpty: () => options.empty === true,
    getSize: () => ({ width, height }),
    resize: ({ width: w, height: h }) => {
      const next = fakeImage(w, h, options)
      image.resized = { width: w, height: h }
      return next
    },
    toBitmap: () => Buffer.alloc(width * height * 4, options.opaque === false ? 128 : 255),
    toPNG: () => png(width, height),
    toJPEG: () => jpeg(width, height)
  }
  return image
}

let root: string
let directory: string
let upright: { width: number; height: number }[]
let log: ReturnType<typeof vi.fn<(message: string, meta?: Record<string, unknown>) => void>>

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'vrx-app-background-'))
  directory = join(root, 'store')
  upright = []
  log = vi.fn<(message: string, meta?: Record<string, unknown>) => void>()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function store(
  decode: (bytes: Buffer) => RenditionImage = () => fakeImage(1920, 1080)
): AppBackgroundStore {
  return new AppBackgroundStore({
    directory,
    decode,
    fromBitmap: (_bitmap, size) => {
      upright.push(size)
      return fakeImage(size.width, size.height)
    },
    log
  })
}

async function source(name: string, bytes: Buffer): Promise<string> {
  const path = join(root, name)
  await writeFile(path, bytes)
  return path
}

describe('picture headers', () => {
  it('recognizes PNG and JPEG signatures only', () => {
    expect(sniffPictureType(png(1, 1))).toBe('image/png')
    expect(sniffPictureType(jpeg(1, 1))).toBe('image/jpeg')
    expect(sniffPictureType(Buffer.from('GIF89a'))).toBeNull()
    expect(sniffPictureType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(sniffPictureType(Buffer.alloc(0))).toBeNull()
  })

  it('reads the size from the header without decoding', () => {
    expect(readPictureSize(png(4000, 3000), 'image/png')).toEqual({ width: 4000, height: 3000 })
    expect(readPictureSize(jpeg(1280, 720), 'image/jpeg')).toEqual({ width: 1280, height: 720 })
  })

  it('rejects truncated or malformed headers', () => {
    expect(readPictureSize(png(10, 10).subarray(0, 20), 'image/png')).toBeNull()
    expect(readPictureSize(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]), 'image/jpeg')).toBe(
      null
    )
    expect(readPictureSize(Buffer.from([0xff, 0xd8, 0x00, 0x00, 0x00]), 'image/jpeg')).toBeNull()
    expect(
      readPictureSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0x00]), 'image/jpeg')
    ).toBeNull()
  })
})

/** A JPEG whose APP1 Exif segment carries one orientation entry. */
function orientedJpeg(orientation: number, little = true): Buffer {
  const u16 = (value: number): number[] =>
    little ? [value & 0xff, value >> 8] : [value >> 8, value & 0xff]
  const u32 = (value: number): number[] => (little ? [value, 0, 0, 0] : [0, 0, 0, value])
  const tiff = [
    ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42),
    ...u32(8),
    ...u16(1),
    ...u16(0x0112),
    ...u16(3),
    ...u32(1),
    ...u16(orientation),
    0,
    0,
    ...u32(0)
  ]
  const payload = [...Buffer.from('Exif\0\0', 'latin1'), ...tiff]
  const length = payload.length + 2
  const app1 = [0xff, 0xe1, length >> 8, length & 0xff, ...payload]
  // Header size only; the fake decoder decides the pixels.
  const plain = jpeg(1200, 800)
  return Buffer.concat([plain.subarray(0, 2), Buffer.from(app1), plain.subarray(2)])
}

describe('EXIF orientation', () => {
  it('reads the orientation in either byte order', () => {
    for (let orientation = 1; orientation <= 8; orientation += 1) {
      expect(readJpegOrientation(orientedJpeg(orientation))).toBe(orientation)
      expect(readJpegOrientation(orientedJpeg(orientation, false))).toBe(orientation)
    }
  })

  it('treats a missing, out-of-range or broken orientation as upright', () => {
    expect(readJpegOrientation(jpeg(10, 10))).toBe(1)
    expect(readJpegOrientation(orientedJpeg(9))).toBe(1)
    const broken = orientedJpeg(6)
    broken.writeUInt16BE(0xffff, 4)
    expect(readJpegOrientation(broken)).toBe(1)
  })

  /** 3x2 picture, pixel value = its stored index, so moves are easy to read. */
  const stored = new Uint8Array(new Uint32Array([0, 1, 2, 3, 4, 5]).buffer)
  const pixels = (bitmap: Buffer): number[] => [...new Uint32Array(Uint8Array.from(bitmap).buffer)]

  it.each([
    [1, 3, 2, [0, 1, 2, 3, 4, 5]],
    [2, 3, 2, [2, 1, 0, 5, 4, 3]],
    [3, 3, 2, [5, 4, 3, 2, 1, 0]],
    [4, 3, 2, [3, 4, 5, 0, 1, 2]],
    [5, 2, 3, [0, 3, 1, 4, 2, 5]],
    [6, 2, 3, [3, 0, 4, 1, 5, 2]],
    [7, 2, 3, [5, 2, 4, 1, 3, 0]],
    [8, 2, 3, [2, 5, 1, 4, 0, 3]]
  ])('turns orientation %i upright', (orientation, width, height, expected) => {
    const result = orientBitmap(stored, 3, 2, orientation)
    expect({ width: result.width, height: result.height }).toEqual({ width, height })
    expect(pixels(result.bitmap)).toEqual(expected)
  })
})

describe('AppBackgroundStore', () => {
  it('has no picture before one is chosen', async () => {
    await expect(store().load()).resolves.toBeNull()
    expect(log).not.toHaveBeenCalled()
  })

  it('keeps a fresh JPEG copy of an opaque picture and loads it back', async () => {
    const backgrounds = store()
    const result = await backgrounds.importFrom(await source('photo.jpg', jpeg(1920, 1080)))
    expect(result).toEqual({
      ok: true,
      dataUrl: `data:image/jpeg;base64,${jpeg(1920, 1080).toString('base64')}`
    })
    await expect(backgrounds.load()).resolves.toBe(result.ok ? result.dataUrl : null)
    // Only the kept file remains; no temp files are left behind.
    expect(await readdir(directory)).toEqual(['picture'])
  })

  it('keeps transparency as PNG', async () => {
    const backgrounds = store(() => fakeImage(800, 600, { opaque: false }))
    const result = await backgrounds.importFrom(await source('cutout.png', png(800, 600)))
    expect(result.ok && result.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('scales a large picture down to the maximum edge, keeping its shape', async () => {
    const image = fakeImage(8000, 4000)
    const backgrounds = store(() => image)
    await backgrounds.importFrom(await source('wide.png', png(8000, 4000)))
    expect(image.resized).toEqual({ width: APP_BACKGROUND_MAX_EDGE, height: 1920 })
  })

  it('turns a sideways phone photo upright before keeping it', async () => {
    const backgrounds = store(() => fakeImage(40, 20))
    const result = await backgrounds.importFrom(await source('phone.jpg', orientedJpeg(6)))
    expect(result.ok).toBe(true)
    expect(upright).toEqual([{ width: 20, height: 40 }])
  })

  it('leaves upright photos and PNGs alone', async () => {
    await store().importFrom(await source('flat.jpg', jpeg(640, 480)))
    await store().importFrom(await source('flat.png', png(640, 480)))
    expect(upright).toEqual([])
  })

  it('refuses files that are not PNG or JPEG without decoding them', async () => {
    const decode = vi.fn(() => fakeImage(10, 10))
    const result = await store(decode).importFrom(
      await source('art.gif', Buffer.from('GIF89a........'))
    )
    expect(result).toEqual({ ok: false, reason: 'unsupported' })
    expect(decode).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('app background import failed', { reason: 'unsupported' })
  })

  it('refuses a picture with too many pixels before decoding it', async () => {
    const decode = vi.fn(() => fakeImage(10, 10))
    const result = await store(decode).importFrom(await source('huge.png', png(30_000, 30_000)))
    expect(result).toEqual({ ok: false, reason: 'too-large' })
    expect(decode).not.toHaveBeenCalled()
  })

  it('refuses pictures too small, too tall or too wide to fill the window, without decoding them', async () => {
    const decode = vi.fn(() => fakeImage(10, 10))
    const backgrounds = store(decode)
    const cases: [string, Buffer, string][] = [
      ['icon.png', png(256, 256), 'too-small'],
      ['dot.png', png(1, 1), 'too-small'],
      ['screenshot.png', png(1080, 2340), 'too-tall'],
      ['strip.jpg', jpeg(4000, 400), 'too-wide'],
      ['line.png', png(65_000, 1), 'too-wide']
    ]
    for (const [name, bytes, reason] of cases) {
      await expect(backgrounds.importFrom(await source(name, bytes))).resolves.toEqual({
        ok: false,
        reason
      })
    }
    expect(decode).not.toHaveBeenCalled()
  })

  it('judges the shape of a phone photo by its upright size', async () => {
    // Stored 1200 × 800 and tagged to turn a quarter: upright it is 800 × 1200, still usable.
    const turned = await store(() => fakeImage(1200, 800)).importFrom(
      await source('phone.jpg', orientedJpeg(6))
    )
    expect(turned.ok).toBe(true)
    // Stored 1600 × 700 (fine as is) but upright 700 × 1600, which is too tall.
    const tall = Buffer.from(orientedJpeg(6))
    const frame = tall.indexOf(Buffer.from([0xff, 0xc0]))
    tall.writeUInt16BE(700, frame + 5)
    tall.writeUInt16BE(1600, frame + 7)
    await expect(store().importFrom(await source('tall.jpg', tall))).resolves.toEqual({
      ok: false,
      reason: 'too-tall'
    })
  })

  it('refuses a file over the size limit', async () => {
    const big = Buffer.alloc(APP_BACKGROUND_MAX_SOURCE_BYTES + 1)
    png(10, 10).copy(big)
    const result = await store().importFrom(await source('big.png', big))
    expect(result).toEqual({ ok: false, reason: 'too-large' })
  })

  it('reports a picture the decoder cannot read', async () => {
    const result = await store(() => fakeImage(0, 0, { empty: true })).importFrom(
      await source('broken.png', png(1200, 800))
    )
    expect(result).toEqual({ ok: false, reason: 'unreadable' })
    await expect(store().load()).resolves.toBeNull()
  })

  it('refuses relative paths, folders and missing files', async () => {
    const backgrounds = store()
    await expect(backgrounds.importFrom('photo.png')).resolves.toEqual({
      ok: false,
      reason: 'unreadable'
    })
    await mkdir(join(root, 'folder'))
    await expect(backgrounds.importFrom(join(root, 'folder'))).resolves.toEqual({
      ok: false,
      reason: 'unreadable'
    })
    await expect(backgrounds.importFrom(join(root, 'missing.png'))).resolves.toEqual({
      ok: false,
      reason: 'unreadable'
    })
  })

  it('never changes the picked file', async () => {
    const original = png(1200, 800)
    const path = await source('keep.png', original)
    await store().importFrom(path)
    expect(await readFile(path)).toEqual(original)
  })

  it('keeps the earlier picture when a new one fails', async () => {
    const backgrounds = store()
    const first = await backgrounds.importFrom(await source('first.jpg', jpeg(640, 480)))
    await backgrounds.importFrom(await source('bad.gif', Buffer.from('GIF89a')))
    await expect(backgrounds.load()).resolves.toBe(first.ok ? first.dataUrl : 'missing')
  })

  it('reports a failed save and keeps nothing half-written', async () => {
    // A file where the store's folder should be makes every write fail.
    await writeFile(directory, 'not a folder')
    const result = await store().importFrom(await source('photo.jpg', jpeg(640, 480)))
    expect(result).toEqual({ ok: false, reason: 'save-failed' })
  })

  it('forgets the picture on clear, and clearing twice is fine', async () => {
    const backgrounds = store()
    await backgrounds.importFrom(await source('photo.jpg', jpeg(640, 480)))
    await backgrounds.clear()
    await backgrounds.clear()
    await expect(backgrounds.load()).resolves.toBeNull()
  })

  it('ignores a kept file that is not a picture', async () => {
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'picture'), 'hello')
    await expect(store().load()).resolves.toBeNull()
    expect(log).toHaveBeenCalledWith('app background unreadable', { reason: 'format' })
  })

  it('runs a clear queued behind an import after that import', async () => {
    const backgrounds = store()
    const path = await source('photo.jpg', jpeg(640, 480))
    const importing = backgrounds.importFrom(path)
    const clearing = backgrounds.clear()
    await Promise.all([importing, clearing])
    await expect(backgrounds.load()).resolves.toBeNull()
  })

  it.skipIf(process.platform === 'win32')('follows a picked shortcut to a picture', async () => {
    const target = await source('real.jpg', jpeg(640, 480))
    const link = join(root, 'link.jpg')
    await symlink(target, link)
    const result = await store().importFrom(link)
    expect(result.ok).toBe(true)
  })

  it('never logs paths', async () => {
    await store().importFrom(join(root, 'secret-name.png'))
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-name')
    expect(JSON.stringify(log.mock.calls)).not.toContain(root)
  })
})
