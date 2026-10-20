export interface MatchSegment {
  text: string
  isMatch: boolean
}

interface FoldedText {
  value: string
  starts: number[]
  ends: number[]
}

// Kana voicing marks (゛゜ as U+3099/U+309A) are part of the letter: は and ば
// are different letters, unlike e and é.
const COMBINING_MARK = /(?![\u3099\u309A])\p{M}/gu
const KANA_VOICING = /^[\u3099\u309A]$/
const KANA = /[\u3040-\u30FF]/

/**
 * Case- and diacritic-fold text while retaining offsets into the original
 * string. The offsets let highlighted segments preserve the user's exact
 * display name rather than rendering the normalized form.
 */
function foldWithOffsets(text: string): FoldedText {
  let value = ''
  const starts: number[] = []
  const ends: number[] = []
  let offset = 0

  for (const character of text) {
    const start = offset
    offset += character.length
    // NFKD also folds full-width and half-width forms (ＶＲ → vr, ﾀ → タ).
    // Kana are recomposed so は and ば stay distinct letters; other scripts keep
    // the decomposition (a Hangul jamo still finds its syllable).
    const decomposed = character.normalize('NFKD').replace(COMBINING_MARK, '')
    const foldedCharacter = (KANA.test(decomposed) ? decomposed.normalize('NFC') : decomposed)
      .toLowerCase()
      .replace(/ς/g, 'σ')

    // A half-width voicing mark (ｶﾞ) is its own character; join it to the kana
    // before it so it matches the composed letter (ガ).
    if (KANA_VOICING.test(foldedCharacter) && value.length > 0) {
      const composed = (value.slice(-1) + foldedCharacter).normalize('NFC')
      if (composed.length === 1) {
        value = value.slice(0, -1) + composed
        ends[ends.length - 1] = offset
        continue
      }
    }

    // Keep a decomposed combining mark attached to the preceding highlighted
    // character so slicing never leaves the accent outside the match span.
    if (foldedCharacter.length === 0) {
      if (ends.length > 0) ends[ends.length - 1] = offset
      continue
    }

    value += foldedCharacter
    for (let index = 0; index < foldedCharacter.length; index += 1) {
      starts.push(start)
      ends.push(offset)
    }
  }

  return { value, starts, ends }
}

/**
 * Split a display name into matched and unmatched segments. Matching is
 * case-insensitive and diacritic-insensitive, while returned text always
 * preserves the original spelling and code points.
 */
export function splitByMatch(name: string, query: string): MatchSegment[] {
  if (name.length === 0) return []

  const foldedName = foldWithOffsets(name)
  const foldedQuery = foldWithOffsets(query).value
  if (foldedQuery.length === 0) return [{ text: name, isMatch: false }]

  const segments: MatchSegment[] = []
  let foldedCursor = 0
  let originalCursor = 0

  while (foldedCursor < foldedName.value.length) {
    const matchIndex = foldedName.value.indexOf(foldedQuery, foldedCursor)
    if (matchIndex === -1) break

    const originalStart = foldedName.starts[matchIndex]
    const originalEnd = foldedName.ends[matchIndex + foldedQuery.length - 1]
    if (originalStart === undefined || originalEnd === undefined) break

    if (originalStart > originalCursor) {
      segments.push({ text: name.slice(originalCursor, originalStart), isMatch: false })
    }
    // Different normalized matches may map to overlapping original syllables.
    // Emit each original code unit only once, even for partial Hangul matches.
    if (originalEnd > originalCursor) {
      segments.push({
        text: name.slice(Math.max(originalStart, originalCursor), originalEnd),
        isMatch: true
      })
    }

    foldedCursor = matchIndex + foldedQuery.length
    originalCursor = originalEnd
  }

  if (segments.length === 0) return [{ text: name, isMatch: false }]
  if (originalCursor < name.length) {
    segments.push({ text: name.slice(originalCursor), isMatch: false })
  }
  return segments
}
