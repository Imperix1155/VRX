import type { AvatarRenditionMaker } from './avatarCache'
import type { StoredImage } from './imageDiskStore'

/**
 * Small copies of friend pictures for `AvatarCache`'s `avatar` rendition.
 *
 * Friend pictures show at most 64 px wide, but VRChat profile icons are often
 * 1,024 px or more. Keeping the full image cost megabytes per friend three
 * times over: the data URL in main, its copy in the renderer, and the decoded
 * bitmap. A copy whose short side is 192 px (64 px at 300% display scaling)
 * looks the same at every supported size and is a few kilobytes.
 */

/** Short-side length of an avatar rendition: the 64 px drawer avatar at 3x. */
export const AVATAR_RENDITION_EDGE = 192
/** JPEG quality for opaque renditions. */
export const AVATAR_RENDITION_JPEG_QUALITY = 88

/** The part of Electron's `NativeImage` a rendition needs. */
export interface RenditionImage {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  resize(options: { width: number; height: number; quality: 'good' }): RenditionImage
  toBitmap(): Buffer
  toPNG(): Buffer
  toJPEG(quality: number): Buffer
}

/** Only formats Electron decodes on every platform; animated GIFs stay animated. */
const DECODABLE = new Set(['image/png', 'image/jpeg'])

/** True when every pixel of a 32-bit bitmap is fully opaque (alpha is the 4th byte). */
export function isOpaque(bitmap: Buffer): boolean {
  for (let index = 3; index < bitmap.length; index += 4) {
    if (bitmap[index] !== 255) return false
  }
  return true
}

/**
 * Build the rendition maker over an image decoder (`nativeImage.createFromBuffer`
 * in the app). It returns null, keeping the original, for formats it cannot
 * decode and for pictures already within the rendition size. The file size is
 * not a guide: a flat 1,024 px icon can be a few kilobytes on disk and still
 * decode to a 4 MB bitmap, so any picture with more pixels is scaled down.
 */
export function createAvatarRenditionMaker(
  decode: (bytes: Buffer) => RenditionImage
): AvatarRenditionMaker {
  return (image: StoredImage): StoredImage | null => {
    if (!DECODABLE.has(image.contentType)) return null
    const source = decode(image.bytes)
    if (source.isEmpty()) return null
    const { width, height } = source.getSize()
    const shortEdge = Math.min(width, height)
    if (!(shortEdge > AVATAR_RENDITION_EDGE)) return null
    const scale = AVATAR_RENDITION_EDGE / shortEdge
    const resized = source.resize({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
      quality: 'good'
    })
    if (resized.isEmpty()) return null
    // Profile icons are often transparent PNGs; only opaque pictures become JPEG.
    const rendition: StoredImage = isOpaque(resized.toBitmap())
      ? { contentType: 'image/jpeg', bytes: resized.toJPEG(AVATAR_RENDITION_JPEG_QUALITY) }
      : { contentType: 'image/png', bytes: resized.toPNG() }
    return rendition.bytes.byteLength === 0 ? null : rendition
  }
}
