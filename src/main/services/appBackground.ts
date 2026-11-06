import { randomBytes } from 'node:crypto'
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { backgroundPictureRefusal } from '@shared/backgroundPicture'
import type { AppBackgroundResult } from '@shared/ipc'
import { isOpaque, type RenditionImage } from './avatarRendition'

/**
 * The user's own background picture (Settings → Appearance).
 *
 * Contract:
 *  - Main reads only the file the user picked in the native open dialog; the
 *    renderer never sends a path. The source must be a regular PNG or JPEG
 *    file within {@link APP_BACKGROUND_MAX_SOURCE_BYTES}, and its header
 *    dimensions must fit {@link APP_BACKGROUND_MAX_SOURCE_PIXELS} and pass
 *    `backgroundPictureRefusal` (size and shape, upright) before anything is
 *    decoded.
 *  - The picture is decoded, scaled to at most {@link APP_BACKGROUND_MAX_EDGE}
 *    on its long side, turned upright by its EXIF orientation (the decoder
 *    ignores it, and the fresh copy carries no metadata), and re-encoded (JPEG
 *    when opaque, PNG otherwise). Only that fresh copy is kept, so metadata in
 *    the original never lands in app storage, and the user's file is never
 *    changed.
 *  - One file under the injected directory (an app.getPath() child), written
 *    atomically (temp + rename). Reads are bounded and checked by signature.
 *  - Operations run one at a time in call order. Failures return a typed
 *    reason; the log callback never receives paths or file names.
 */

export const APP_BACKGROUND_DIRECTORY = 'app-background'
/** Largest picked file VRX reads. Phone and camera photos sit well below it. */
export const APP_BACKGROUND_MAX_SOURCE_BYTES = 40 * 1024 * 1024
/** Largest source picture VRX decodes (about 50 megapixels, 200 MB decoded). */
export const APP_BACKGROUND_MAX_SOURCE_PIXELS = 50_000_000
/** Long-side length of the kept copy: full-screen on a 4K display. */
export const APP_BACKGROUND_MAX_EDGE = 3840
/** Largest kept copy; a 4K JPEG is normally a few megabytes. */
export const APP_BACKGROUND_MAX_STORED_BYTES = 24 * 1024 * 1024
export const APP_BACKGROUND_JPEG_QUALITY = 88

const FILE_NAME = 'picture'
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

type PictureType = 'image/png' | 'image/jpeg'

export function sniffPictureType(bytes: Uint8Array): PictureType | null {
  if (bytes.length >= 8 && PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  return null
}

/** Start-of-frame markers carry the picture size; DHT, JPG and DAC share the range. */
function isJpegFrameMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

/**
 * Width and height from the file header, without decoding. Returns null when
 * the header is missing or malformed.
 */
export function readPictureSize(
  bytes: Uint8Array,
  type: PictureType
): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (type === 'image/png') {
    // Signature (8), IHDR length (4) and type (4), then width and height.
    if (bytes.length < 24 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return null
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null
    const marker = view.getUint8(offset + 1)
    // Fill bytes, then markers without a length (TEM, RST0-7).
    if (marker === 0xff) {
      offset += 1
      continue
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    // Start of scan or end of image before any frame header.
    if (marker === 0xda || marker === 0xd9) return null
    const length = view.getUint16(offset + 2)
    if (length < 2) return null
    if (isJpegFrameMarker(marker)) {
      if (offset + 9 > bytes.length) return null
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) }
    }
    offset += 2 + length
  }
  return null
}

/**
 * EXIF orientation (1-8) of a JPEG, read from the APP1 Exif segment's first
 * directory. Returns 1 (as stored) when there is none or it is malformed.
 */
export function readJpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (view.getUint8(offset) !== 0xff) return 1
    const marker = view.getUint8(offset + 1)
    if (marker === 0xff) {
      offset += 1
      continue
    }
    if (marker === 0xda || marker === 0xd9) return 1
    const length = view.getUint16(offset + 2)
    if (length < 2 || offset + 2 + length > bytes.length) return 1
    const exif = offset + 4
    if (
      marker === 0xe1 &&
      length >= 16 &&
      String.fromCharCode(...bytes.subarray(exif, exif + 6)) === 'Exif\0\0'
    ) {
      const tiff = exif + 6
      const end = offset + 2 + length
      const order = String.fromCharCode(...bytes.subarray(tiff, tiff + 2))
      if (order !== 'II' && order !== 'MM') return 1
      const little = order === 'II'
      const ifd = tiff + view.getUint32(tiff + 4, little)
      if (ifd + 2 > end) return 1
      const entries = view.getUint16(ifd, little)
      for (let index = 0; index < entries; index += 1) {
        const entry = ifd + 2 + index * 12
        if (entry + 12 > end) return 1
        if (view.getUint16(entry, little) !== 0x0112) continue
        const value = view.getUint16(entry + 8, little)
        return value >= 1 && value <= 8 ? value : 1
      }
      return 1
    }
    offset += 2 + length
  }
  return 1
}

/**
 * Turn a tightly packed 32-bit bitmap upright for an EXIF orientation. Returns
 * the new pixels and size; orientations 5-8 swap width and height.
 */
export function orientBitmap(
  bitmap: Uint8Array,
  width: number,
  height: number,
  orientation: number
): { bitmap: Buffer; width: number; height: number } {
  const swap = orientation >= 5 && orientation <= 8
  const outWidth = swap ? height : width
  const outHeight = swap ? width : height
  const source = new Uint32Array(Uint8Array.from(bitmap).buffer)
  const target = new Uint32Array(outWidth * outHeight)
  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      let sx = x
      let sy = y
      switch (orientation) {
        case 2:
          sx = width - 1 - x
          break
        case 3:
          sx = width - 1 - x
          sy = height - 1 - y
          break
        case 4:
          sy = height - 1 - y
          break
        case 5:
          sx = y
          sy = x
          break
        case 6:
          sx = y
          sy = height - 1 - x
          break
        case 7:
          sx = width - 1 - y
          sy = height - 1 - x
          break
        case 8:
          sx = width - 1 - y
          sy = x
          break
      }
      target[y * outWidth + x] = source[sy * width + sx] ?? 0
    }
  }
  return { bitmap: Buffer.from(target.buffer), width: outWidth, height: outHeight }
}

function dataUrl(type: PictureType, bytes: Buffer): string {
  return `data:${type};base64,${bytes.toString('base64')}`
}

/** Read at most `limit + 1` bytes of a regular file, so growth past the limit shows. */
async function readBounded(
  path: string,
  limit: number
): Promise<{ bytes: Buffer } | { error: 'missing' | 'too-large' | 'unreadable' }> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(path, 'r')
    const stats = await handle.stat()
    if (!stats.isFile()) return { error: 'unreadable' }
    if (stats.size > limit) return { error: 'too-large' }
    const buffer = Buffer.alloc(Math.min(stats.size, limit) + 1)
    let total = 0
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total)
      if (bytesRead === 0) break
      total += bytesRead
    }
    if (total > limit) return { error: 'too-large' }
    return { bytes: buffer.subarray(0, total) }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    return { error: code === 'ENOENT' ? 'missing' : 'unreadable' }
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

export interface AppBackgroundStoreOptions {
  directory: string
  /** `nativeImage.createFromBuffer` in the app. */
  decode: (bytes: Buffer) => RenditionImage
  /** `nativeImage.createFromBitmap` in the app: tightly packed 32-bit pixels. */
  fromBitmap: (bitmap: Buffer, size: { width: number; height: number }) => RenditionImage
  log?: (message: string, meta?: Record<string, unknown>) => void
}

export class AppBackgroundStore {
  private readonly directory: string
  private readonly decode: AppBackgroundStoreOptions['decode']
  private readonly fromBitmap: AppBackgroundStoreOptions['fromBitmap']
  private readonly log: NonNullable<AppBackgroundStoreOptions['log']>
  private queue: Promise<unknown> = Promise.resolve()

  constructor(options: AppBackgroundStoreOptions) {
    this.directory = options.directory
    this.decode = options.decode
    this.fromBitmap = options.fromBitmap
    this.log = options.log ?? (() => undefined)
  }

  private get filePath(): string {
    return join(this.directory, FILE_NAME)
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => undefined)
    return run
  }

  /** The kept picture as a `data:` URL, or null when there is none or it is unusable. */
  load(): Promise<string | null> {
    return this.serialize(async () => {
      const read = await readBounded(this.filePath, APP_BACKGROUND_MAX_STORED_BYTES)
      if ('error' in read) {
        if (read.error !== 'missing') this.log('app background unreadable', { reason: read.error })
        return null
      }
      const type = sniffPictureType(read.bytes)
      if (type === null) {
        this.log('app background unreadable', { reason: 'format' })
        return null
      }
      return dataUrl(type, read.bytes)
    })
  }

  /** Make a fresh copy of the picked picture and keep it in place of any earlier one. */
  importFrom(sourcePath: string): Promise<AppBackgroundResult> {
    return this.serialize(async () => {
      const result = await this.importNow(sourcePath)
      if (!result.ok) this.log('app background import failed', { reason: result.reason })
      return result
    })
  }

  /** Forget the picture. A missing file already counts as removed. */
  clear(): Promise<void> {
    return this.serialize(() => rm(this.filePath, { force: true }))
  }

  private async importNow(sourcePath: string): Promise<AppBackgroundResult> {
    if (typeof sourcePath !== 'string' || !isAbsolute(sourcePath)) {
      return { ok: false, reason: 'unreadable' }
    }
    const read = await readBounded(sourcePath, APP_BACKGROUND_MAX_SOURCE_BYTES)
    if ('error' in read) {
      return { ok: false, reason: read.error === 'too-large' ? 'too-large' : 'unreadable' }
    }
    const type = sniffPictureType(read.bytes)
    if (type === null) return { ok: false, reason: 'unsupported' }
    const size = readPictureSize(read.bytes, type)
    if (size === null || size.width < 1 || size.height < 1) {
      return { ok: false, reason: 'unreadable' }
    }
    if (size.width * size.height > APP_BACKGROUND_MAX_SOURCE_PIXELS) {
      return { ok: false, reason: 'too-large' }
    }
    const orientation = type === 'image/jpeg' ? readJpegOrientation(read.bytes) : 1
    const turned = orientation >= 5
    const refusal = backgroundPictureRefusal(
      turned ? size.height : size.width,
      turned ? size.width : size.height
    )
    if (refusal !== null) return { ok: false, reason: refusal }

    let source = this.decode(read.bytes)
    if (source.isEmpty()) return { ok: false, reason: 'unreadable' }
    const { width, height } = source.getSize()
    const longEdge = Math.max(width, height)
    if (longEdge > APP_BACKGROUND_MAX_EDGE) {
      const scale = APP_BACKGROUND_MAX_EDGE / longEdge
      source = source.resize({
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
        quality: 'good'
      })
      if (source.isEmpty()) return { ok: false, reason: 'unreadable' }
    }
    let bitmap = source.toBitmap()
    const current = source.getSize()
    // Only a tightly packed bitmap can be turned; anything else stays as stored.
    if (orientation !== 1 && bitmap.length === current.width * current.height * 4) {
      const upright = orientBitmap(bitmap, current.width, current.height, orientation)
      source = this.fromBitmap(upright.bitmap, { width: upright.width, height: upright.height })
      if (source.isEmpty()) return { ok: false, reason: 'unreadable' }
      bitmap = upright.bitmap
    }
    const opaque = isOpaque(bitmap)
    const keptType: PictureType = opaque ? 'image/jpeg' : 'image/png'
    const kept = opaque ? source.toJPEG(APP_BACKGROUND_JPEG_QUALITY) : source.toPNG()
    if (kept.byteLength === 0 || sniffPictureType(kept) !== keptType) {
      return { ok: false, reason: 'unreadable' }
    }
    if (kept.byteLength > APP_BACKGROUND_MAX_STORED_BYTES) return { ok: false, reason: 'too-large' }

    const temp = join(this.directory, `${FILE_NAME}.${randomBytes(8).toString('hex')}.tmp`)
    try {
      await mkdir(this.directory, { recursive: true })
      await writeFile(temp, kept, { mode: 0o600 })
      await rename(temp, this.filePath)
    } catch {
      await rm(temp, { force: true }).catch(() => undefined)
      return { ok: false, reason: 'save-failed' }
    }
    return { ok: true, dataUrl: dataUrl(keptType, kept) }
  }
}
