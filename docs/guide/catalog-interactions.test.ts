// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '@renderer/i18n'
import CatalogScene from './catalog-scenes'
import { sourceScenarios } from './scenarios'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('selectable guide scenarios', () => {
  it.each([
    ['loading', 'VRChat'],
    ['loading-cvr', 'ChilloutVR']
  ])('renders the selectable %s state beside retained cards', (variant, platform) => {
    expect(sourceScenarios.some((scenario) => scenario.value === variant)).toBe(true)
    render(createElement(CatalogScene, { scene: 'feedback', variant }))
    expect(screen.getByText(`${platform} worlds are loading…`)).toBeTruthy()
    expect(screen.getAllByText(/People/).length).toBeGreaterThan(0)
  })

  it('keeps retained-card refresh quiet through the selectable fixture', () => {
    expect(sourceScenarios.some((scenario) => scenario.value === 'refreshing')).toBe(true)
    render(createElement(CatalogScene, { scene: 'feedback', variant: 'refreshing' }))
    expect(screen.queryByText(/worlds are loading/)).toBeNull()
    expect(screen.getAllByText(/People/).length).toBeGreaterThan(0)
  })

  it.each(['explore', 'materials'])(
    '%s opens fresh rooms after time passes and Refresh restores expired room actions',
    async (scene) => {
      vi.useFakeTimers()
      // Later than module evaluation: successful fixture reads must timestamp the read itself.
      vi.setSystemTime(Date.now() + 61_000)
      render(createElement(CatalogScene, { scene, variant: 'ready' }))
      fireEvent.click(screen.getAllByRole('button', { name: /Open visible rooms for/ })[0]!)
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Join' }).disabled).toBe(false)
      await act(async () => {
        vi.advanceTimersByTime(61_000)
      })
      expect(screen.queryByRole('button', { name: 'Join' })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Join' }).disabled).toBe(false)
    }
  )
})
