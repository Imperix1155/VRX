/**
 * How well a background picture fits the VRX window (Settings → Appearance).
 *
 * The picture fills the window and is cropped to it (`object-fit: cover`), and
 * VRX windows are landscape: 900 × 670 at the smallest, usually 16:9 or wider.
 * Main refuses pictures that cannot work at all (`too-small`, `too-tall`,
 * `too-wide`); Settings warns about ones that work but look off (`tall`,
 * `wide`, `low-res`). Sizes are of the upright picture, after any EXIF turn.
 */

/** Below this a picture is stretched three times or more on a Full HD screen. */
export const BACKGROUND_PICTURE_MIN_WIDTH = 640
export const BACKGROUND_PICTURE_MIN_HEIGHT = 360
/** Below this a picture looks soft on a Full HD screen. */
export const BACKGROUND_PICTURE_SHARP_WIDTH = 1280
export const BACKGROUND_PICTURE_SHARP_HEIGHT = 720
/** Width ÷ height. A 9:16 phone screenshot (0.56) shows only a third of itself. */
export const BACKGROUND_PICTURE_MIN_ASPECT = 0.6
/** Width ÷ height. Anything taller than this loses most of its height. */
export const BACKGROUND_PICTURE_TALL_ASPECT = 0.9
/** Width ÷ height. Wider than 3:1 shows half or less of itself at 16:9. */
export const BACKGROUND_PICTURE_WIDE_ASPECT = 3
/** Width ÷ height. Wider than 5:1 shows about a third of itself at 16:9. */
export const BACKGROUND_PICTURE_MAX_ASPECT = 5

export type BackgroundPictureRefusal = 'too-small' | 'too-tall' | 'too-wide'
export type BackgroundPictureWarning = 'tall' | 'wide' | 'low-res'

/** Why a picture cannot be a background, or null when it can. Shape is checked first. */
export function backgroundPictureRefusal(
  width: number,
  height: number
): BackgroundPictureRefusal | null {
  if (!(width > 0) || !(height > 0)) return 'too-small'
  const aspect = width / height
  if (aspect < BACKGROUND_PICTURE_MIN_ASPECT) return 'too-tall'
  if (aspect > BACKGROUND_PICTURE_MAX_ASPECT) return 'too-wide'
  if (width < BACKGROUND_PICTURE_MIN_WIDTH || height < BACKGROUND_PICTURE_MIN_HEIGHT) {
    return 'too-small'
  }
  return null
}

/**
 * The one thing most worth telling the user about a usable picture, or null
 * when it fits well. Cropping matters more than softness, so shape comes first.
 */
export function backgroundPictureWarning(
  width: number,
  height: number
): BackgroundPictureWarning | null {
  if (!(width > 0) || !(height > 0)) return null
  const aspect = width / height
  if (aspect < BACKGROUND_PICTURE_TALL_ASPECT) return 'tall'
  if (aspect > BACKGROUND_PICTURE_WIDE_ASPECT) return 'wide'
  if (width < BACKGROUND_PICTURE_SHARP_WIDTH || height < BACKGROUND_PICTURE_SHARP_HEIGHT) {
    return 'low-res'
  }
  return null
}
