const graphemes = new Intl.Segmenter()

/** Leading spaces and invisible format marks (text direction, zero-width). */
const LEADING_INVISIBLE = /^[\s\p{Cf}]+/u

/**
 * A name's first user-perceived character, upper-cased, for picture
 * placeholders; "?" for a blank name. charAt(0) would split emoji and styled
 * letters ("🌸Sakura", "𝓙osh") into half a surrogate pair, which shows as "�".
 * Invisible marks at the start are skipped, so the placeholder never shows blank.
 */
export function initialOf(name: string): string {
  const first = graphemes.segment(name.replace(LEADING_INVISIBLE, ''))[Symbol.iterator]().next()
  return first.done === true ? '?' : first.value.segment.toUpperCase()
}
