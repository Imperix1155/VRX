import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PICTURE_COLUMN_STEPS, fillRows, pictureColumns } from './pictureColumns'

describe('pictureColumns', () => {
  it('matches the picture grid steps', () => {
    expect(pictureColumns(300)).toBe(1)
    expect(pictureColumns(579)).toBe(2)
    expect(pictureColumns(1479)).toBe(2)
    expect(pictureColumns(1599)).toBe(3)
    expect(pictureColumns(3119)).toBe(5)
    expect(pictureColumns(4799)).toBe(7)
    expect(pictureColumns(9000)).toBe(8)
  })

  it('stays in step with the container queries in main.css', () => {
    const css = readFileSync(join(__dirname, '../assets/main.css'), 'utf8')
    const steps = [...css.matchAll(/@container \(min-width: (\d+)px\) \{\s*\.picture-grid\b/g)].map(
      (match) => Number(match[1])
    )
    expect(steps).toEqual([...PICTURE_COLUMN_STEPS])
  })
})

describe('fillRows', () => {
  it('rounds up to whole rows and never shows fewer than asked', () => {
    expect(fillRows(4, 2)).toBe(4)
    expect(fillRows(4, 3)).toBe(6)
    expect(fillRows(4, 5)).toBe(5)
    expect(fillRows(4, 7)).toBe(7)
    expect(fillRows(6, 5)).toBe(10)
    expect(fillRows(2, 1)).toBe(2)
  })
})
