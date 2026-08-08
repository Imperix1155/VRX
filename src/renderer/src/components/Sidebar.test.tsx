// @vitest-environment jsdom
/**
 * Sidebar nav indicator test (VRX-172).
 *
 * Pins the active-item left spine to the global platform filter: the spine's
 * color is a reinforcing echo of the filter state. Position still means
 * "active page"; the segmented toggle remains the primary carrier.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import i18n from '../i18n'
import { useUiStore } from '../stores/ui'
import { useFriendsStore, type PlatformFilter } from '../stores/friends'
import Sidebar from './Sidebar'

afterEach(() => {
  cleanup()
  useUiStore.setState({ activeTab: 'dashboard', settingsCategory: 'appearance' })
  useFriendsStore.setState({ platformFilter: 'all' })
})

describe('Sidebar active indicator (VRX-172)', () => {
  const cases: Array<{ filter: PlatformFilter; binding: string }> = [
    { filter: 'all', binding: 'all' },
    { filter: 'vrchat', binding: 'vrchat' },
    { filter: 'chilloutvr', binding: 'chilloutvr' }
  ]

  it.each(cases)(
    'binds the active spine to the platform filter ($filter)',
    ({ filter, binding }) => {
      useFriendsStore.setState({ platformFilter: filter })
      render(<Sidebar />)

      const activeButton = screen.getByRole('button', { current: 'page' })
      const spine = activeButton.querySelector('[data-platform-filter]')

      expect(spine).not.toBeNull()
      expect(spine?.getAttribute('data-platform-filter')).toBe(binding)
    }
  )

  it('only renders the spine on the active nav item', () => {
    useUiStore.setState({ activeTab: 'friends' })
    render(<Sidebar />)

    const activeButton = screen.getByRole('button', { current: 'page' })
    expect(activeButton.textContent).toContain(i18n.t('shell.nav.friends'))
    expect(activeButton.querySelector('[data-platform-filter]')).not.toBeNull()

    const allButtons = screen.getAllByRole('button')
    expect(
      allButtons.filter((b) => b.querySelector('[data-platform-filter]') !== null)
    ).toHaveLength(1)
  })
})
