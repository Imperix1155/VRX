// @vitest-environment jsdom
/**
 * useDragReorder (quick reorder; owner, 2026-11-15): a press stays a click, a
 * drag reports the new order once on release, the arrow keys move the focused
 * row and keep focus on it, and nothing happens while it is disabled.
 */
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useDragReorder } from './useDragReorder'

const ROW_HEIGHT = 40
const ROW_STEP = 43

function List({
  enabled = true,
  onClick,
  onOrder
}: {
  enabled?: boolean
  onClick: (id: string) => void
  onOrder: (next: string[]) => void
}): React.JSX.Element {
  const [items, setItems] = useState(['a', 'b', 'c', 'd'])
  const { itemProps, draggingId } = useDragReorder<string>({
    items,
    enabled,
    onReorder: (next) => {
      setItems(next)
      onOrder(next)
    }
  })
  return (
    <ul data-dragging-id={draggingId ?? ''}>
      {items.map((id) => {
        const drag = itemProps(id)
        return (
          <li key={id}>
            <button
              type="button"
              onClick={() => onClick(id)}
              ref={drag?.ref}
              style={drag?.style}
              data-dragging={drag?.['data-dragging']}
              onPointerDown={drag?.onPointerDown}
              onPointerMove={drag?.onPointerMove}
              onPointerUp={drag?.onPointerUp}
              onPointerCancel={drag?.onPointerCancel}
              onClickCapture={drag?.onClickCapture}
              onKeyDown={drag?.onKeyDown}
            >
              {id}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** jsdom has no layout: give each row a box from its place in the list. */
function stubRows(): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const rows = [...document.querySelectorAll('button')]
    const top = Math.max(0, rows.indexOf(this as HTMLButtonElement)) * ROW_STEP
    return {
      top,
      bottom: top + ROW_HEIGHT,
      left: 0,
      right: 200,
      width: 200,
      height: ROW_HEIGHT,
      x: 0,
      y: top,
      toJSON: () => ({})
    }
  })
}

function order(): string[] {
  return screen.getAllByRole('button').map((button) => button.textContent ?? '')
}

function setup(enabled = true): {
  onClick: ReturnType<typeof vi.fn>
  onOrder: ReturnType<typeof vi.fn>
} {
  const onClick = vi.fn()
  const onOrder = vi.fn()
  stubRows()
  render(<List enabled={enabled} onClick={onClick} onOrder={onOrder} />)
  return { onClick, onOrder }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useDragReorder', () => {
  it('drags a row down two places and reports the order once, on release', () => {
    const { onClick, onOrder } = setup()
    const row = screen.getByRole('button', { name: 'a' })
    fireEvent.pointerDown(row, { pointerId: 1, button: 0, clientY: 20 })
    fireEvent.pointerMove(row, { pointerId: 1, clientY: 20 + 2 * ROW_STEP })
    // While dragging: the row follows the pointer and the passed rows step up.
    expect(row.getAttribute('data-dragging')).toBe('true')
    expect(row.style.transform).toBe(`translateY(${2 * ROW_STEP}px)`)
    expect(screen.getByRole('button', { name: 'b' }).style.transform).toBe(
      `translateY(-${ROW_STEP}px)`
    )
    expect(screen.getByRole('button', { name: 'd' }).style.transform).toBe('translateY(0px)')
    expect(onOrder).not.toHaveBeenCalled()

    fireEvent.pointerUp(row, { pointerId: 1, clientY: 20 + 2 * ROW_STEP })
    expect(onOrder).toHaveBeenCalledTimes(1)
    expect(order()).toEqual(['b', 'c', 'a', 'd'])
    // The click that ends a drag does not also press the row.
    fireEvent.click(screen.getByRole('button', { name: 'a' }))
    expect(onClick).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'a' }).style.transform).toBe('')
  })

  it('keeps a press that barely moves as a click', () => {
    const { onClick, onOrder } = setup()
    const row = screen.getByRole('button', { name: 'b' })
    fireEvent.pointerDown(row, { pointerId: 1, button: 0, clientY: 60 })
    fireEvent.pointerMove(row, { pointerId: 1, clientY: 62 })
    fireEvent.pointerUp(row, { pointerId: 1, clientY: 62 })
    fireEvent.click(row)
    expect(onOrder).not.toHaveBeenCalled()
    expect(onClick).toHaveBeenCalledWith('b')
  })

  it('never drags past the ends and drops nothing on a cancel', () => {
    const { onOrder } = setup()
    const row = screen.getByRole('button', { name: 'c' })
    fireEvent.pointerDown(row, { pointerId: 1, button: 0, clientY: 100 })
    fireEvent.pointerMove(row, { pointerId: 1, clientY: -900 })
    expect(row.style.transform).toBe(`translateY(-${2 * ROW_STEP}px)`)
    fireEvent.pointerCancel(row, { pointerId: 1 })
    expect(onOrder).not.toHaveBeenCalled()
    expect(order()).toEqual(['a', 'b', 'c', 'd'])

    fireEvent.pointerDown(row, { pointerId: 2, button: 0, clientY: 100 })
    fireEvent.pointerMove(row, { pointerId: 2, clientY: -900 })
    fireEvent.pointerUp(row, { pointerId: 2, clientY: -900 })
    expect(order()).toEqual(['c', 'a', 'b', 'd'])
  })

  it('ignores the right button and a second pointer', () => {
    const { onOrder } = setup()
    const row = screen.getByRole('button', { name: 'a' })
    fireEvent.pointerDown(row, { pointerId: 1, button: 2, clientY: 20 })
    fireEvent.pointerMove(row, { pointerId: 1, clientY: 120 })
    fireEvent.pointerUp(row, { pointerId: 1, clientY: 120 })
    expect(onOrder).not.toHaveBeenCalled()

    fireEvent.pointerDown(row, { pointerId: 1, button: 0, clientY: 20 })
    fireEvent.pointerMove(row, { pointerId: 7, clientY: 120 })
    expect(row.getAttribute('data-dragging')).toBeNull()
  })

  it('moves the focused row with the arrow keys and keeps focus on it', () => {
    const { onOrder } = setup()
    const row = screen.getByRole('button', { name: 'b' })
    row.focus()
    fireEvent.keyDown(row, { key: 'ArrowDown' })
    expect(order()).toEqual(['a', 'c', 'b', 'd'])
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'b' }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'b' }), { key: 'ArrowUp' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'b' }), { key: 'ArrowUp' })
    expect(order()).toEqual(['b', 'a', 'c', 'd'])
    // At the top there is nowhere to go.
    fireEvent.keyDown(screen.getByRole('button', { name: 'b' }), { key: 'ArrowUp' })
    expect(order()).toEqual(['b', 'a', 'c', 'd'])
    expect(onOrder).toHaveBeenCalledTimes(3)
    // A modified arrow belongs to something else.
    fireEvent.keyDown(screen.getByRole('button', { name: 'b' }), { key: 'ArrowDown', altKey: true })
    expect(onOrder).toHaveBeenCalledTimes(3)
  })

  it('does nothing while disabled', () => {
    const { onClick, onOrder } = setup(false)
    const row = screen.getByRole('button', { name: 'a' })
    fireEvent.pointerDown(row, { pointerId: 1, button: 0, clientY: 20 })
    fireEvent.pointerMove(row, { pointerId: 1, clientY: 120 })
    fireEvent.pointerUp(row, { pointerId: 1, clientY: 120 })
    fireEvent.keyDown(row, { key: 'ArrowDown' })
    fireEvent.click(row)
    expect(onOrder).not.toHaveBeenCalled()
    expect(onClick).toHaveBeenCalledWith('a')
  })
})
