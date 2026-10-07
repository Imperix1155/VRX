import { describe, expect, it } from 'vitest'
import { splitByMatch } from './splitByMatch'

describe('splitByMatch', () => {
  it('matches without regard to case while preserving the original text', () => {
    expect(splitByMatch('VRChat Friend', 'chat')).toEqual([
      { text: 'VR', isMatch: false },
      { text: 'Chat', isMatch: true },
      { text: ' Friend', isMatch: false }
    ])
  })

  it('matches precomposed diacritics against an unaccented query', () => {
    expect(splitByMatch('José', 'jose')).toEqual([{ text: 'José', isMatch: true }])
  })

  it('keeps decomposed combining marks inside the highlighted segment', () => {
    expect(splitByMatch('Jose\u0301 Alvarez', 'jose')).toEqual([
      { text: 'Jose\u0301', isMatch: true },
      { text: ' Alvarez', isMatch: false }
    ])
  })

  it('splits every non-overlapping occurrence', () => {
    expect(splitByMatch('Banana', 'an')).toEqual([
      { text: 'B', isMatch: false },
      { text: 'an', isMatch: true },
      { text: 'an', isMatch: true },
      { text: 'a', isMatch: false }
    ])
  })

  it.each(['ΟΣ', 'ος', 'οσ'])('uses the same Sigma fold for name and query %s', (query) => {
    expect(splitByMatch('ΟΣ', query)).toEqual([{ text: 'ΟΣ', isMatch: true }])
  })

  it.each([
    ['갂', 'ᆩ'],
    ['각', 'ᄀ'],
    ['각', '각']
  ])('preserves original Hangul %s when matching %s', (name, query) => {
    const parts = splitByMatch(name, query)
    expect(parts.map((part) => part.text).join('')).toBe(name)
    expect(parts.some((part) => part.isMatch)).toBe(true)
  })

  it('does not duplicate a syllable when multiple decomposed units match', () => {
    const overlaps = splitByMatch('가가가가', 'ᅡᄀ')
    expect(overlaps.map((part) => part.text).join('')).toBe('가가가가')
    expect(overlaps.every((part) => part.isMatch)).toBe(true)
    expect(splitByMatch('까', 'ᄁ')).toEqual([{ text: '까', isMatch: true }])
    expect(splitByMatch('각각', 'ᅡ')).toEqual([
      { text: '각', isMatch: true },
      { text: '각', isMatch: true }
    ])
    expect(splitByMatch('힣', 'ᇂ')).toEqual([{ text: '힣', isMatch: true }])
  })

  it('returns one unmatched segment when the query is empty or absent', () => {
    expect(splitByMatch('Alice', '')).toEqual([{ text: 'Alice', isMatch: false }])
    expect(splitByMatch('Alice', 'zed')).toEqual([{ text: 'Alice', isMatch: false }])
  })
})
