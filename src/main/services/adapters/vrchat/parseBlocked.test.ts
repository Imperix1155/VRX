import { describe, expect, it } from 'vitest'
import { parseVrcBlocked } from './parseBlocked'

const ID = 'usr_11111111-2222-3333-4444-555555555555'

describe('parseVrcBlocked', () => {
  it('is true only for a block of exactly that person', () => {
    expect(parseVrcBlocked([{ type: 'block', targetUserId: ID }], ID)).toBe(true)
    expect(parseVrcBlocked([], ID)).toBe(false)
    expect(parseVrcBlocked([{ type: 'mute', targetUserId: ID }], ID)).toBe(false)
    expect(parseVrcBlocked([{ type: 'block', targetUserId: 'usr_other' }], ID)).toBe(false)
  })

  it('skips malformed records and refuses a reply that is not a list', () => {
    expect(parseVrcBlocked([null, 'x', [1], { type: 'block', targetUserId: ID }], ID)).toBe(true)
    expect(parseVrcBlocked({ type: 'block', targetUserId: ID }, ID)).toBeNull()
    expect(parseVrcBlocked(null, ID)).toBeNull()
  })
})
