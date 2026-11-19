/**
 * Quick reorder maths (owner, 2026-11-15): where a dragged row lands, how far
 * its neighbours step aside, and that it never leaves the list.
 */
import { describe, expect, it } from 'vitest'
import { clampDrag, dropIndex, moveItem, rowGap, rowShift, type RowBox } from './reorder'

/** Four 40 px rows, 3 px apart: tops 0, 43, 86, 129. */
const ROWS: RowBox[] = [0, 43, 86, 129].map((top) => ({ top, height: 40 }))

describe('dropIndex', () => {
  it('stays put until the dragged edge passes a neighbour’s middle', () => {
    expect(dropIndex(ROWS, 1, 0)).toBe(1)
    // Row 1 bottom is 83; row 2's middle is 106.
    expect(dropIndex(ROWS, 1, 22)).toBe(1)
    expect(dropIndex(ROWS, 1, 24)).toBe(2)
    // Row 1 top is 43; row 0's middle is 20.
    expect(dropIndex(ROWS, 1, -22)).toBe(1)
    expect(dropIndex(ROWS, 1, -24)).toBe(0)
  })

  it('crosses several rows and reaches both ends', () => {
    expect(dropIndex(ROWS, 0, 129)).toBe(3)
    expect(dropIndex(ROWS, 3, -129)).toBe(0)
    expect(dropIndex(ROWS, 0, 70)).toBe(2)
  })

  it('works for rows of different heights', () => {
    const rows: RowBox[] = [
      { top: 0, height: 200 },
      { top: 208, height: 40 },
      { top: 256, height: 120 }
    ]
    // The small row's top must pass the tall row's middle (100) to go first.
    expect(dropIndex(rows, 1, -100)).toBe(1)
    expect(dropIndex(rows, 1, -109)).toBe(0)
    // The tall row's bottom (200) must pass the small row's middle (228).
    expect(dropIndex(rows, 0, 27)).toBe(0)
    expect(dropIndex(rows, 0, 29)).toBe(1)
  })

  it('answers an unknown row with its own index', () => {
    expect(dropIndex(ROWS, 9, 50)).toBe(9)
  })
})

describe('clampDrag', () => {
  it('keeps the dragged row between the first and last slot', () => {
    expect(clampDrag(ROWS, 1, -500)).toBe(-43)
    expect(clampDrag(ROWS, 1, 500)).toBe(86)
    expect(clampDrag(ROWS, 1, 12)).toBe(12)
    expect(clampDrag(ROWS, 0, -5)).toBe(0)
    expect(clampDrag([], 0, 30)).toBe(0)
  })
})

describe('rowShift', () => {
  it('moves the rows between the old and new slot by one row and its gap', () => {
    expect(rowGap(ROWS)).toBe(3)
    // Row 0 dragged to slot 2: rows 1 and 2 step up, row 3 stays.
    expect([0, 1, 2, 3].map((index) => rowShift(ROWS, 0, 2, index))).toEqual([0, -43, -43, 0])
    // Row 3 dragged to slot 1: rows 1 and 2 step down.
    expect([0, 1, 2, 3].map((index) => rowShift(ROWS, 3, 1, index))).toEqual([0, 43, 43, 0])
    // Nothing moves while the row is over its own slot.
    expect([0, 1, 2, 3].map((index) => rowShift(ROWS, 2, 2, index))).toEqual([0, 0, 0, 0])
    expect(rowGap([{ top: 0, height: 40 }])).toBe(0)
  })
})

describe('moveItem', () => {
  it('moves one entry and leaves the input alone', () => {
    const items = ['a', 'b', 'c', 'd']
    expect(moveItem(items, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(items, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(items).toEqual(['a', 'b', 'c', 'd'])
  })

  it('ignores a move that goes nowhere or outside the list', () => {
    const items = ['a', 'b']
    expect(moveItem(items, 0, 0)).toEqual(items)
    expect(moveItem(items, 0, 2)).toEqual(items)
    expect(moveItem(items, -1, 0)).toEqual(items)
  })
})
