export interface MatchSegment {
  text: string
  isMatch: boolean
}

interface FoldedText {
  value: string
  starts: number[]
  ends: number[]
}

const COMBINING_MARK = /\p{M}/gu

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
    const foldedCharacter = character.normalize('NFD').replace(COMBINING_MARK, '').toLowerCase()

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

function fold(text: string): string {
  return text.normalize('NFD').replace(COMBINING_MARK, '').toLowerCase()
}

/**
 * Split a display name into matched and unmatched segments. Matching is
 * case-insensitive and diacritic-insensitive, while returned text always
 * preserves the original spelling and code points.
 */
export function splitByMatch(name: string, query: string): MatchSegment[] {
  if (name.length === 0) return []

  const foldedName = foldWithOffsets(name)
  const foldedQuery = fold(query)
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
    segments.push({ text: name.slice(originalStart, originalEnd), isMatch: true })

    foldedCursor = matchIndex + foldedQuery.length
    originalCursor = originalEnd
  }

  if (segments.length === 0) return [{ text: name, isMatch: false }]
  if (originalCursor < name.length) {
    segments.push({ text: name.slice(originalCursor), isMatch: false })
  }
  return segments
}
