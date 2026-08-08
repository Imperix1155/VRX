// @vitest-environment jsdom
/**
 * Sidebar nav indicator + update button tests (VRX-172 / VRX-113).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import i18n from '../i18n'
import { useUiStore } from '../stores/ui'
import { useFriendsStore, type PlatformFilter } from '../stores/friends'
import type { UpdaterSnapshot } from '@shared/ipc'
import Sidebar from './Sidebar'

type MockFn = ReturnType<typeof vi.fn>

const updaterState: {
  state: UpdaterSnapshot
  check: MockFn
  download: MockFn
  install: MockFn
} = vi.hoisted(() => ({
  state: {
    state: 'idle',
    currentVersion: '0.14.0',
    availableVersion: null,
    progressPercent: 0,
    errorMessage: null
  },
  check: vi.fn(),
  download: vi.fn(),
  install: vi.fn()
}))
vi.mock('../hooks/useUpdater', () => ({
  useUpdater: () => updaterState
}))

afterEach(() => {
  cleanup()
  useUiStore.setState({ activeTab: 'dashboard', settingsCategory: 'appearance' })
  useFriendsStore.setState({ platformFilter: 'all' })
  updaterState.state = {
    state: 'idle',
    currentVersion: '0.14.0',
    availableVersion: null,
    progressPercent: 0,
    errorMessage: null
  }
  updaterState.check.mockReset()
  updaterState.download.mockReset()
  updaterState.install.mockReset()
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

describe('Sidebar update button (VRX-113)', () => {
  it('does not render when idle', () => {
    render(<Sidebar />)
    expect(screen.queryByRole('button', { name: /update/i })).toBeNull()
  })

  it('renders a collapsed circle for update-available with download aria-label', () => {
    updaterState.state = {
      state: 'update-available',
      currentVersion: '0.14.0',
      availableVersion: '0.15.0',
      progressPercent: 0,
      errorMessage: null
    }
    render(<Sidebar />)

    const button = screen.getByRole('button', { name: i18n.t('updater.sidebar.downloadAria') })
    expect(button).toBeTruthy()
    // Collapsed width (36px, the footer text-block grid height) — the label is hidden.
    expect(button.className).toContain('w-[36px]')
    fireEvent.click(button)
    expect(updaterState.download).toHaveBeenCalledOnce()
  })

  it('appends the error suffix to update-available title/aria-label when a previous attempt failed', () => {
    updaterState.state = {
      state: 'update-available',
      currentVersion: '0.14.0',
      availableVersion: '0.15.0',
      progressPercent: 0,
      errorMessage: 'network down'
    }
    render(<Sidebar />)

    const expectedAria = `${i18n.t('updater.sidebar.downloadAria')} ${i18n.t('updater.sidebar.errorSuffix')}`
    const expectedTitle = `${i18n.t('updater.sidebar.downloadTitle')} ${i18n.t('updater.sidebar.errorSuffix')}`
    const button = screen.getByRole('button', { name: expectedAria })
    expect(button.getAttribute('title')).toBe(expectedTitle)
  })

  it('expands to show the label on focus', () => {
    updaterState.state = {
      state: 'update-available',
      currentVersion: '0.14.0',
      availableVersion: '0.15.0',
      progressPercent: 0,
      errorMessage: null
    }
    render(<Sidebar />)

    const button = screen.getByRole('button', { name: i18n.t('updater.sidebar.downloadAria') })
    expect(button.className).toContain('focus-visible:w-[104px]')
  })

  it('renders downloading state with progress and disables clicks', () => {
    updaterState.state = {
      state: 'downloading',
      currentVersion: '0.14.0',
      availableVersion: '0.15.0',
      progressPercent: 42,
      errorMessage: null
    }
    render(<Sidebar />)

    const button = screen.getByRole('button', {
      name: i18n.t('updater.sidebar.downloadingAria', { percent: 42 })
    })
    expect(button).toBeTruthy()
    expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(button)
    expect(updaterState.download).not.toHaveBeenCalled()
    expect(updaterState.install).not.toHaveBeenCalled()
  })

  it('renders downloading at 0% with the indeterminate label', () => {
    updaterState.state = {
      state: 'downloading',
      currentVersion: '0.14.0',
      availableVersion: '0.15.0',
      progressPercent: 0,
      errorMessage: null
    }
    render(<Sidebar />)

    const button = screen.getByRole('button', {
      name: i18n.t('updater.sidebar.downloadingAria', { percent: 0 })
    })
    expect(button).toBeTruthy()
    expect(button.textContent).toContain(i18n.t('updater.sidebar.downloadingIndeterminate'))
    expect(button.textContent).not.toContain('0%')
  })

  it('renders downloaded state with restart action', () => {
    updaterState.state = {
      state: 'downloaded',
      currentVersion: '0.14.0',
      availableVersion: '0.15.0',
      progressPercent: 100,
      errorMessage: null
    }
    render(<Sidebar />)

    const button = screen.getByRole('button', { name: i18n.t('updater.sidebar.restartAria') })
    expect(button).toBeTruthy()
    fireEvent.click(button)
    expect(updaterState.install).toHaveBeenCalledOnce()
  })
})
