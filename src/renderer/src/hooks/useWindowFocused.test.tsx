// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useWindowFocused } from './useWindowFocused'

function Probe(): React.JSX.Element {
  return <span data-testid="focused">{String(useWindowFocused())}</span>
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useWindowFocused', () => {
  it('follows window focus and blur', () => {
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    render(<Probe />)
    expect(screen.getByTestId('focused').textContent).toBe('true')

    hasFocus.mockReturnValue(false)
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(screen.getByTestId('focused').textContent).toBe('false')

    hasFocus.mockReturnValue(true)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(screen.getByTestId('focused').textContent).toBe('true')
  })

  it('stops listening after unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(<Probe />)
    unmount()
    expect(remove).toHaveBeenCalledWith('focus', expect.any(Function))
    expect(remove).toHaveBeenCalledWith('blur', expect.any(Function))
  })
})
