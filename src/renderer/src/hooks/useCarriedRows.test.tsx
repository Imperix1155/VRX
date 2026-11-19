// @vitest-environment jsdom
import { cleanup, renderHook, type RenderHookResult } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useCarriedRows, type CarriedReset } from './useCarriedRows'

afterEach(cleanup)

interface Row {
  id: number
  text: string
}

const idOf = (row: Row): number => row.id
const row = (id: number, text = `row ${id}`): Row => ({ id, text })

const keep = (retained = '90d', replaced = 'a'): CarriedReset => ({ replaced, retained })

interface Props {
  first: Row[] | undefined
  reset: CarriedReset
}

function carry(
  first: Row[] | undefined,
  reset: CarriedReset = keep()
): RenderHookResult<ReadonlyMap<number, Row>, Props> {
  return renderHook((props: Props) => useCarriedRows(props.first, idOf, props.reset), {
    initialProps: { first, reset }
  })
}

const ids = (rows: ReadonlyMap<number, Row>): number[] => [...rows.keys()].sort((a, b) => a - b)

describe('useCarriedRows', () => {
  it('keeps a row that a newer one pushed off the first page', () => {
    const view = carry([row(3), row(2)])
    expect(ids(view.result.current)).toEqual([2, 3])
    view.rerender({ first: [row(4), row(3)], reset: keep() })
    expect(ids(view.result.current)).toEqual([2, 3, 4])
    view.rerender({ first: [row(5), row(4)], reset: keep() })
    expect(ids(view.result.current)).toEqual([2, 3, 4, 5])
  })

  it('holds the rows in the same render the first page changes', () => {
    const seen: number[][] = []
    const view = renderHook(
      (props: { first: Row[] }) => {
        const rows = useCarriedRows(props.first, idOf, keep())
        seen.push(ids(rows))
        return rows
      },
      { initialProps: { first: [row(2), row(1)] } }
    )
    view.rerender({ first: [row(3), row(2)] })
    // Never a render that shows the new page without the row that left it.
    expect(seen.every((shown) => shown.includes(1))).toBe(true)
  })

  it('keeps a row seen again in its newest form', () => {
    const view = carry([row(2, 'open'), row(1)])
    view.rerender({ first: [row(3), row(2, 'ended')], reset: keep() })
    view.rerender({ first: [row(4), row(3)], reset: keep() })
    expect(view.result.current.get(2)).toEqual(row(2, 'ended'))
  })

  it('keeps what it has while the first page is not read or is empty', () => {
    const view = carry([row(2), row(1)])
    view.rerender({ first: undefined, reset: keep() })
    expect(ids(view.result.current)).toEqual([1, 2])
    view.rerender({ first: [], reset: keep() })
    expect(ids(view.result.current)).toEqual([1, 2])
  })

  it('drops everything on a new reset key, the page it holds at that moment too', () => {
    const page = [row(3), row(2)]
    const view = carry(page)
    view.rerender({ first: page, reset: keep('90d', 'b') })
    // What was just cleared or replaced is never carried on.
    expect(ids(view.result.current)).toEqual([])
    view.rerender({ first: [row(9)], reset: keep('90d', 'b') })
    expect(ids(view.result.current)).toEqual([9])
  })

  it('starts again from the page read after a reset', () => {
    const view = carry([row(3), row(2)])
    view.rerender({ first: undefined, reset: keep('90d', 'b') })
    view.rerender({ first: [row(8), row(7)], reset: keep('90d', 'b') })
    view.rerender({ first: [row(9), row(8)], reset: keep('90d', 'b') })
    expect(ids(view.result.current)).toEqual([7, 8, 9])
  })

  it('reseeds the same page when retention changes, so the next page cannot drop a row', () => {
    const page = [row(3), row(2)]
    const view = carry(page)
    view.rerender({ first: page, reset: keep('1y') })
    expect(ids(view.result.current)).toEqual([2, 3])
    view.rerender({ first: [row(4), row(3)], reset: keep('1y') })
    expect(ids(view.result.current)).toEqual([2, 3, 4])
  })

  it('does not reseed a page a replacement is about to discard, even when retention changes too', () => {
    const page = [row(3), row(2)]
    const view = carry(page)
    view.rerender({ first: page, reset: keep('1y', 'b') })
    expect(ids(view.result.current)).toEqual([])
    view.rerender({ first: [row(9)], reset: keep('1y', 'b') })
    expect(ids(view.result.current)).toEqual([9])
  })
})
