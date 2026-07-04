// @vitest-environment jsdom
/**
 * NumberStepper unit tests (VRX-78, advisor follow-up): clamping, the ARIA
 * spinbutton keyboard set, single-Tab-stop structure, and bound-disable
 * behavior — tested directly rather than only via DashboardView.
 */
import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import NumberStepper from './NumberStepper'

function setup(value: number): { onChange: ReturnType<typeof vi.fn> } {
  const onChange = vi.fn()
  render(<NumberStepper value={value} min={1} max={10} onChange={onChange} ariaLabel="Threshold" />)
  return { onChange }
}

afterEach(cleanup)

describe('NumberStepper', () => {
  it('renders a spinbutton with the value and bounds', () => {
    setup(3)
    const spin = screen.getByRole('spinbutton', { name: 'Threshold' })
    expect(spin.getAttribute('aria-valuenow')).toBe('3')
    expect(spin.getAttribute('aria-valuemin')).toBe('1')
    expect(spin.getAttribute('aria-valuemax')).toBe('10')
    expect(spin.textContent).toBe('3')
  })

  it('buttons step by one and never fire outside the bounds', () => {
    const { onChange } = setup(1)
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }))
    expect(onChange).toHaveBeenCalledWith(2)
    // At min, decrease is disabled and must not fire.
    fireEvent.click(screen.getByRole('button', { name: 'Decrease' }))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('keyboard: arrows step, Home/End jump to the bounds, no change past them', () => {
    const { onChange } = setup(5)
    const spin = screen.getByRole('spinbutton', { name: 'Threshold' })
    fireEvent.keyDown(spin, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith(6)
    fireEvent.keyDown(spin, { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith(4)
    fireEvent.keyDown(spin, { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith(1)
    fireEvent.keyDown(spin, { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith(10)
  })

  it('at a bound the keyboard is a no-op (clamped, not wrapped)', () => {
    const { onChange } = setup(10)
    const spin = screen.getByRole('spinbutton', { name: 'Threshold' })
    fireEvent.keyDown(spin, { key: 'ArrowUp' })
    fireEvent.keyDown(spin, { key: 'End' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('is ONE Tab stop: the value is focusable, the buttons are not', () => {
    setup(5)
    expect(screen.getByRole('spinbutton', { name: 'Threshold' }).tabIndex).toBe(0)
    expect(screen.getByRole('button', { name: 'Decrease' }).tabIndex).toBe(-1)
    expect(screen.getByRole('button', { name: 'Increase' }).tabIndex).toBe(-1)
  })
})
