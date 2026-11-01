const graphemes = new Intl.Segmenter()

/**
 * A name's first user-perceived character, upper-cased, for picture
 * placeholders; "?" for a blank name. charAt(0) would split emoji and styled
 * letters ("🌸Sakura", "𝓙osh") into half a surrogate pair, which shows as "�".
 */
export function initialOf(name: string): string {
  const first = graphemes.segment(name.trim())[Symbol.iterator]().next()
  return first.done === true ? '?' : first.value.segment.toUpperCase()
}
