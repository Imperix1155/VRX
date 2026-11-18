// @vitest-environment jsdom
import { cleanup, renderHook, type RenderHookResult } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useCarriedRows } from './useCarriedRows'

afterEach(cleanup)

interface Row {
  id: number
  text: string
}

const idOf = (row: Row): number => row.id
const row = (id: number, text = `row ${id}`): Row => ({ id, text })

interface Props {
  first: Row[] | undefined
  resetKey: string
}

function carry(
  first: Row[] | undefined,
  resetKey = 'a'
): RenderHookResult<ReadonlyMap<number, Row>, Props> {
  return renderHook(
    (props: { first: Row[] | undefined; resetKey: string }) =>
      useCarriedRows(props.first, idOf, props.resetKey),
    {
      initialProps: { first, resetKey }
    }
  )
}

const ids = (rows: ReadonlyMap<number, Row>): number[] => [...rows.keys()].sort((a, b) => a - b)

describe('useCarriedRows', () => {
  it('keeps a row that a newer one pushed off the first page', () => {
    const view = carry([row(3), row(2)])
    expect(ids(view.result.current)).toEqual([2, 3])
    view.rerender({ first: [row(4), row(3)], resetKey: 'a' })
    expect(ids(view.result.current)).toEqual([2, 3, 4])
    view.rerender({ first: [row(5), row(4)], resetKey: 'a' })
    expect(ids(view.result.current)).toEqual([2, 3, 4, 5])
  })

  it('holds the rows in the same render the first page changes', () => {
    const seen: number[][] = []
    const view = renderHook(
      (props: { first: Row[] }) => {
        const rows = useCarriedRows(props.first, idOf, 'a')
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
    view.rerender({ first: [row(3), row(2, 'ended')], resetKey: 'a' })
    view.rerender({ first: [row(4), row(3)], resetKey: 'a' })
    expect(view.result.current.get(2)).toEqual(row(2, 'ended'))
  })

  it('keeps what it has while the first page is not read or is empty', () => {
    const view = carry([row(2), row(1)])
    view.rerender({ first: undefined, resetKey: 'a' })
    expect(ids(view.result.current)).toEqual([1, 2])
    view.rerender({ first: [], resetKey: 'a' })
    expect(ids(view.result.current)).toEqual([1, 2])
  })

  it('drops everything on a new reset key, the page it holds at that moment too', () => {
    const page = [row(3), row(2)]
    const view = carry(page)
    view.rerender({ first: page, resetKey: 'b' })
    // What was just cleared or replaced is never carried on.
    expect(ids(view.result.current)).toEqual([])
    view.rerender({ first: [row(9)], resetKey: 'b' })
    expect(ids(view.result.current)).toEqual([9])
  })

  it('starts again from the page read after a reset', () => {
    const view = carry([row(3), row(2)])
    view.rerender({ first: undefined, resetKey: 'b' })
    view.rerender({ first: [row(8), row(7)], resetKey: 'b' })
    view.rerender({ first: [row(9), row(8)], resetKey: 'b' })
    expect(ids(view.result.current)).toEqual([7, 8, 9])
  })
})
