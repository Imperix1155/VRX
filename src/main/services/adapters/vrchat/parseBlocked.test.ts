import { describe, expect, it } from 'vitest'
import { MAX_MODERATIONS, isVrcBlocked, parseVrcBlockList } from './parseBlocked'

const ID = 'usr_11111111-2222-3333-4444-555555555555'
const OTHER = 'usr_99999999-2222-3333-4444-555555555555'

function blocked(value: unknown, userId = ID): boolean | null {
  const list = parseVrcBlockList(value)
  return list === null ? null : isVrcBlocked(list, userId)
}

describe('parseVrcBlockList', () => {
  it('is true only for a block of exactly that person', () => {
    expect(blocked([{ type: 'block', targetUserId: ID }])).toBe(true)
    expect(blocked([])).toBe(false)
    expect(blocked([{ type: 'mute', targetUserId: ID }])).toBe(false)
    expect(blocked([{ type: 'interactOff', targetUserId: ID }])).toBe(false)
    expect(blocked([{ type: 'block', targetUserId: OTHER }])).toBe(false)
  })

  it('reads every block from the whole list, as VRCX asks for it', () => {
    const list = parseVrcBlockList([
      { type: 'mute', targetUserId: ID },
      { type: 'block', targetUserId: OTHER },
      { type: 'block', targetUserId: ID }
    ])
    expect(list?.ids).toEqual(new Set([OTHER, ID]))
    expect(list?.complete).toBe(true)
  })

  it('skips malformed records and refuses a reply that is not a list', () => {
    expect(
      blocked([
        null,
        'x',
        [1],
        { type: 'block', targetUserId: 7 },
        { type: 'block', targetUserId: ID }
      ])
    ).toBe(true)
    expect(parseVrcBlockList({ type: 'block', targetUserId: ID })).toBeNull()
    expect(parseVrcBlockList(null)).toBeNull()
  })

  it('answers unknown, not "not blocked", past the records it reads', () => {
    const many = Array.from({ length: MAX_MODERATIONS + 1 }, () => ({
      type: 'mute',
      targetUserId: OTHER
    }))
    expect(blocked(many)).toBeNull()
    many[0] = { type: 'block', targetUserId: ID }
    expect(blocked(many)).toBe(true)
  })
})
