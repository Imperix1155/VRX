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

  it('returns one unmatched segment when the query is empty or absent', () => {
    expect(splitByMatch('Alice', '')).toEqual([{ text: 'Alice', isMatch: false }])
    expect(splitByMatch('Alice', 'zed')).toEqual([{ text: 'Alice', isMatch: false }])
  })
})
