// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useScrimDismiss } from './useScrimDismiss'

function Scrim({ enabled, dismiss }: { enabled: boolean; dismiss: () => void }): React.JSX.Element {
  const { onPointerDown, onClick } = useScrimDismiss(enabled, dismiss)
  return <div data-testid="scrim" onPointerDown={onPointerDown} onClick={onClick} />
}

describe('useScrimDismiss', () => {
  afterEach(cleanup)

  it('closes on a main-button mouse press, which stops there and is cancelled', () => {
    const dismiss = vi.fn()
    const behind = vi.fn()
    document.addEventListener('pointerdown', behind)
    try {
      render(<Scrim enabled dismiss={dismiss} />)
      // Cancelled, so the browser doesn't move focus to the page afterwards.
      expect(fireEvent.pointerDown(screen.getByTestId('scrim'), { pointerType: 'mouse' })).toBe(
        false
      )
      expect(dismiss).toHaveBeenCalledTimes(1)
      expect(behind).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('pointerdown', behind)
    }
  })

  it('leaves the modal open on a middle or right mouse press', () => {
    const dismiss = vi.fn()
    render(<Scrim enabled dismiss={dismiss} />)
    const scrim = screen.getByTestId('scrim')
    for (const button of [1, 2]) {
      expect(fireEvent.pointerDown(scrim, { pointerType: 'mouse', button })).toBe(false)
      fireEvent.click(scrim, { button })
    }
    expect(dismiss).not.toHaveBeenCalled()
  })

  it.each(['touch', 'pen'])('closes on a %s tap’s click, not its press', (pointerType) => {
    const dismiss = vi.fn()
    render(<Scrim enabled dismiss={dismiss} />)
    const scrim = screen.getByTestId('scrim')
    fireEvent.pointerDown(scrim, { pointerType })
    expect(dismiss).not.toHaveBeenCalled()
    fireEvent.click(scrim)
    expect(dismiss).toHaveBeenCalledTimes(1)
    // A later click that no tap began does nothing.
    fireEvent.click(scrim)
    expect(dismiss).toHaveBeenCalledTimes(1)
  })

  it('does nothing while the modal is busy, even for a tap that began before', () => {
    const dismiss = vi.fn()
    const view = render(<Scrim enabled={false} dismiss={dismiss} />)
    const scrim = screen.getByTestId('scrim')
    fireEvent.pointerDown(scrim, { pointerType: 'mouse' })
    fireEvent.pointerDown(scrim, { pointerType: 'touch' })
    fireEvent.click(scrim)
    view.rerender(<Scrim enabled dismiss={dismiss} />)
    fireEvent.pointerDown(scrim, { pointerType: 'touch' })
    view.rerender(<Scrim enabled={false} dismiss={dismiss} />)
    fireEvent.click(scrim)
    expect(dismiss).not.toHaveBeenCalled()
  })
})
