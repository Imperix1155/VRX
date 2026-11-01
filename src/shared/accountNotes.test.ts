import { describe, expect, it } from 'vitest'
import {
  VRCHAT_ACCOUNT_NOTE_MAX_LENGTH,
  accountNoteToSend,
  comparableNote,
  decideAccountNote,
  fitsAccountNote,
  readableAccountNote
} from './accountNotes'

describe('decideAccountNote', () => {
  it('does nothing when both copies match', () => {
    expect(decideAccountNote('a', 'a', undefined)).toBe('in-sync')
    expect(decideAccountNote('a', 'a', 'old')).toBe('in-sync')
    expect(decideAccountNote('', '', undefined)).toBe('in-sync')
  })

  it('lets the only side that changed win', () => {
    expect(decideAccountNote('new', 'old', 'old')).toBe('send-local')
    expect(decideAccountNote('old', 'new', 'old')).toBe('take-account')
    // Clearing a note on one side is a change too.
    expect(decideAccountNote('', 'old', 'old')).toBe('send-local')
    expect(decideAccountNote('old', '', 'old')).toBe('take-account')
  })

  it('asks when both changed', () => {
    expect(decideAccountNote('mine', 'theirs', 'old')).toBe('conflict')
  })

  it('never lets an empty side wipe a note when the copies never matched', () => {
    expect(decideAccountNote('', 'theirs', undefined)).toBe('take-account')
    expect(decideAccountNote('mine', '', undefined)).toBe('send-local')
    expect(decideAccountNote('mine', 'theirs', undefined)).toBe('conflict')
  })
})

describe('VRChat note forms', () => {
  it('puts VRChat look-alike symbols back', () => {
    expect(readableAccountNote('vrchat', 'Met at ＃meetup（Tokyo）․ ｜ ＠name')).toBe(
      'Met at #meetup(Tokyo). | @name'
    )
    expect(readableAccountNote('chilloutvr', '＃kept as is')).toBe('＃kept as is')
  })

  it('sends one line to VRChat and keeps lines for ChilloutVR', () => {
    expect(accountNoteToSend('vrchat', '  first\nsecond  \r\n third ')).toBe('first second third')
    expect(accountNoteToSend('chilloutvr', ' first\r\nsecond ')).toBe('first\nsecond')
  })

  it('counts a multi-line note and its VRChat copy as the same note', () => {
    expect(comparableNote('vrchat', 'Likes #art\nand music')).toBe(
      comparableNote('vrchat', 'Likes ＃art and music')
    )
    expect(comparableNote('chilloutvr', 'a\nb')).toBe(comparableNote('chilloutvr', 'a  b '))
  })

  it('knows the VRChat length cap', () => {
    expect(fitsAccountNote('vrchat', 'x'.repeat(VRCHAT_ACCOUNT_NOTE_MAX_LENGTH))).toBe(true)
    expect(fitsAccountNote('vrchat', 'x'.repeat(VRCHAT_ACCOUNT_NOTE_MAX_LENGTH + 1))).toBe(false)
    expect(fitsAccountNote('chilloutvr', 'x'.repeat(500))).toBe(true)
  })
})
