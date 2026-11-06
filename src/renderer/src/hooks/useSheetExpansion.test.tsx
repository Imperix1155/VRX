// @vitest-environment jsdom
/**
 * useSheetExpansion + SheetGrabBar: the bottom-sheet grab bar drags, clicks
 * and responds to the keyboard.
 */
import { useRef, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import SheetGrabBar from '../components/SheetGrabBar'
import { SHEET_EXPANDED_HEIGHT, useSheetExpansion } from './useSheetExpansion'

const COLLAPSED_HEIGHT = 360

function Harness({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const panelRef = useRef<HTMLDivElement>(null)
  const expansion = useSheetExpansion({
    open,
    onClose: () => {
      onClose()
      setOpen(false)
    },
    panelRef,
    collapsed: { minHeight: '360px', maxHeight: '34vh' }
  })
  return (
    <>
      <button type="button" onClick={() => setOpen((v) => !v)}>
        toggle open
      </button>
      <div
        ref={(node) => {
          panelRef.current = node
          if (node) {
            // jsdom has no layout: report what the collapsed sheet measures.
            node.getBoundingClientRect = () =>
              ({ height: expansion.expanded ? 600 : COLLAPSED_HEIGHT }) as DOMRect
          }
        }}
        data-testid="panel"
        data-open={open ? 'yes' : 'no'}
        style={expansion.panelStyle}
      >
        <SheetGrabBar expansion={expansion} />
      </div>
    </>
  )
}

function bar(): HTMLElement {
  return screen.getByRole('button', { name: /show (more|less)/i })
}

function drag(target: HTMLElement, fromY: number, toY: number): void {
  fireEvent.pointerDown(target, { pointerId: 1, button: 0, clientY: fromY })
  fireEvent.pointerMove(target, { pointerId: 1, clientY: (fromY + toY) / 2 })
  fireEvent.pointerMove(target, { pointerId: 1, clientY: toY })
  fireEvent.pointerUp(target, { pointerId: 1, clientY: toY })
}

describe('useSheetExpansion', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('opens collapsed with the collapsed heights', () => {
    render(<Harness onClose={vi.fn()} />)
    expect(bar().getAttribute('aria-expanded')).toBe('false')
    expect(bar().getAttribute('aria-label')).toBe('Show more')
    const panel = screen.getByTestId('panel')
    expect(panel.style.minHeight).toBe('360px')
    expect(panel.style.maxHeight).toBe('34vh')
  })

  it('toggles on a click, with Enter-style clicks and with arrow keys', () => {
    render(<Harness onClose={vi.fn()} />)
    fireEvent.click(bar())
    expect(bar().getAttribute('aria-expanded')).toBe('true')
    expect(bar().getAttribute('aria-label')).toBe('Show less')
    expect(screen.getByTestId('panel').style.minHeight).toBe(SHEET_EXPANDED_HEIGHT)
    fireEvent.click(bar())
    expect(bar().getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(bar(), { key: 'ArrowUp' })
    expect(bar().getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(bar(), { key: 'ArrowDown' })
    expect(bar().getAttribute('aria-expanded')).toBe('false')
  })

  it('a plain press toggles once even though a click follows it', () => {
    render(<Harness onClose={vi.fn()} />)
    fireEvent.pointerDown(bar(), { pointerId: 1, button: 0, clientY: 10 })
    fireEvent.pointerUp(bar(), { pointerId: 1, clientY: 11 })
    fireEvent.click(bar())
    expect(bar().getAttribute('aria-expanded')).toBe('true')
  })

  it('follows the pointer while dragging, then expands on release', () => {
    render(<Harness onClose={vi.fn()} />)
    fireEvent.pointerDown(bar(), { pointerId: 1, button: 0, clientY: 300 })
    fireEvent.pointerMove(bar(), { pointerId: 1, clientY: 200 })
    const panel = screen.getByTestId('panel')
    expect(panel.style.minHeight).toBe(`${COLLAPSED_HEIGHT + 100}px`)
    expect(panel.style.transition).toBe('none')
    fireEvent.pointerUp(bar(), { pointerId: 1, clientY: 200 })
    expect(bar().getAttribute('aria-expanded')).toBe('true')
    expect(panel.style.transition).toBe('')
  })

  it('snaps back when the drag is short and slow', () => {
    let now = 1_000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    render(<Harness onClose={vi.fn()} />)
    fireEvent.pointerDown(bar(), { pointerId: 1, button: 0, clientY: 300 })
    now += 400
    fireEvent.pointerMove(bar(), { pointerId: 1, clientY: 270 })
    // Held still before letting go, so it is no flick.
    now += 300
    fireEvent.pointerUp(bar(), { pointerId: 1, clientY: 270 })
    expect(bar().getAttribute('aria-expanded')).toBe('false')
  })

  it('a quick short flick up still expands', () => {
    let now = 1_000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    render(<Harness onClose={vi.fn()} />)
    fireEvent.pointerDown(bar(), { pointerId: 1, button: 0, clientY: 300 })
    now += 16
    fireEvent.pointerMove(bar(), { pointerId: 1, clientY: 285 })
    now += 16
    fireEvent.pointerUp(bar(), { pointerId: 1, clientY: 270 })
    expect(bar().getAttribute('aria-expanded')).toBe('true')
  })

  it('drags an expanded sheet back down to collapsed', () => {
    render(<Harness onClose={vi.fn()} />)
    fireEvent.click(bar())
    drag(bar(), 100, 300)
    expect(bar().getAttribute('aria-expanded')).toBe('false')
  })

  it('closes when a collapsed sheet is pulled down', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    fireEvent.pointerDown(bar(), { pointerId: 1, button: 0, clientY: 300 })
    fireEvent.pointerMove(bar(), { pointerId: 1, clientY: 400 })
    // Below the collapsed height the sheet slides instead of shrinking.
    const panel = screen.getByTestId('panel')
    expect(panel.style.minHeight).toBe(`${COLLAPSED_HEIGHT}px`)
    expect(panel.style.translate).toBe('0 100px')
    fireEvent.pointerUp(bar(), { pointerId: 1, clientY: 400 })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a cancelled drag changes nothing', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    fireEvent.pointerDown(bar(), { pointerId: 1, button: 0, clientY: 300 })
    fireEvent.pointerMove(bar(), { pointerId: 1, clientY: 100 })
    fireEvent.pointerCancel(bar(), { pointerId: 1, clientY: 100 })
    expect(bar().getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByTestId('panel').style.minHeight).toBe('360px')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('reopens collapsed', () => {
    render(<Harness onClose={vi.fn()} />)
    fireEvent.click(bar())
    expect(bar().getAttribute('aria-expanded')).toBe('true')
    const toggle = screen.getByRole('button', { name: 'toggle open' })
    fireEvent.click(toggle)
    // Still expanded while it slides away.
    expect(bar().getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    expect(bar().getAttribute('aria-expanded')).toBe('false')
  })
})
