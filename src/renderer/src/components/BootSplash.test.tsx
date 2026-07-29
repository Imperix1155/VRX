// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import '../i18n'
import BootSplash from './BootSplash'

afterEach(cleanup)

describe('BootSplash', () => {
  it('renders the VRX mark and a quiet motion-safe connecting status', () => {
    const { container } = render(<BootSplash />)

    expect(screen.getByRole('img', { name: 'VRX' })).toBeTruthy()
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('Connecting…')
    expect(status.className).toContain('motion-safe:animate-pulse')
    expect(container.querySelector('.glass')).toBeTruthy()
  })
})
