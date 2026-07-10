// @vitest-environment jsdom
/**
 * TopBar onlineCount derivation test (2026-07 audit W6).
 *
 * Pins the §8 status indicator: online = presence 'active' OR 'in-game',
 * summed across BOTH platforms, with the i18next _one/_other plural applied.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import type { Friend } from '@shared/types'
import i18n from '../i18n'
import { useUiStore } from '../stores/ui'
import TopBar from './TopBar'

const useFriendsMock = vi.hoisted(() => vi.fn())
// Keep the real `scopeByPlatformFilter` (pure) — only the hook is stubbed.
vi.mock('../queries/friends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/friends')>()),
  useFriends: useFriendsMock
}))

// jsdom has no ResizeObserver (the bubble-measuring effect observes the track).
class ResizeObserverStub {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

function friend(state: Friend['presence']['state']): Friend {
  return { presence: { state } } as unknown as Friend
}

function stubFriends(vrc: Friend[], cvr: Friend[]): void {
  useFriendsMock.mockImplementation((platform: string) =>
    platform === 'vrchat' ? { data: vrc } : { data: cvr }
  )
}

afterEach(() => {
  cleanup()
  useFriendsMock.mockReset()
  useUiStore.setState({ activeTab: 'dashboard', settingsCategory: 'appearance' })
})

describe('TopBar onlineCount (W6)', () => {
  it('counts active + in-game across both platforms; offline excluded', () => {
    stubFriends(
      [friend('in-game'), friend('active'), friend('offline')],
      [friend('in-game'), friend('offline')]
    )
    render(<TopBar />)
    expect(screen.getByText(i18n.t('shell.onlineCount', { count: 3 }))).toBeTruthy()
  })

  it('uses the singular "N online" form for exactly one online friend', () => {
    stubFriends([friend('active')], [])
    render(<TopBar />)
    expect(screen.getByText('1 online')).toBeTruthy()
  })

  it('renders zero (plural form) when queries have no data yet', () => {
    useFriendsMock.mockImplementation(() => ({ data: undefined }))
    render(<TopBar />)
    expect(screen.getByText(i18n.t('shell.onlineCount', { count: 0 }))).toBeTruthy()
  })
})

describe('TopBar contextual slot (VRX-186)', () => {
  const msg = (key: string): string => i18n.t(key)

  it('shows the platform filter on content views, never the category nav', () => {
    stubFriends([], [])
    render(<TopBar />)
    expect(screen.getByRole('radiogroup', { name: msg('shell.seg.aria') })).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: msg('settings.categories.aria') })).toBeNull()
    expect(screen.getByTestId('topbar-contextual-dock').parentElement?.className).toContain(
      'ml-auto'
    )
    expect(screen.getByRole('status').className).toContain('min-w-[78px]')
    expect(screen.getByRole('status').className).toContain('tabular-nums')
  })

  it('on Settings, swaps in the category nav and drops the platform filter', () => {
    stubFriends([], [])
    useUiStore.setState({ activeTab: 'settings' })
    render(<TopBar />)
    expect(screen.queryByRole('radiogroup', { name: msg('shell.seg.aria') })).toBeNull()
    const nav = screen.getByRole('radiogroup', { name: msg('settings.categories.aria') })
    expect(nav).toBeTruthy()
    // Switching a category writes the ui store the SettingsView reads.
    fireEvent.click(screen.getByRole('radio', { name: msg('settings.dashboard.heading') }))
    expect(useUiStore.getState().settingsCategory).toBe('dashboard')
  })

  it('platform selection survives a Settings round-trip (state lifted above the swap)', () => {
    stubFriends([], [])
    const { rerender } = render(<TopBar />)
    fireEvent.click(screen.getByRole('radio', { name: msg('shell.seg.chilloutvrShort') }))
    expect(
      screen
        .getByRole('radio', { name: msg('shell.seg.chilloutvrShort') })
        .getAttribute('aria-checked')
    ).toBe('true')

    // Into Settings (filter unmounts) and back — the selection must persist.
    useUiStore.setState({ activeTab: 'settings' })
    rerender(<TopBar />)
    expect(screen.queryByRole('radiogroup', { name: msg('shell.seg.aria') })).toBeNull()
    useUiStore.setState({ activeTab: 'dashboard' })
    rerender(<TopBar />)
    expect(
      screen
        .getByRole('radio', { name: msg('shell.seg.chilloutvrShort') })
        .getAttribute('aria-checked')
    ).toBe('true')
  })
})
