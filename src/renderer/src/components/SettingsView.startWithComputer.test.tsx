// @vitest-environment jsdom
/**
 * Start with your computer (owner, 2026-11-11): one row on About, three
 * choices, default Off. Main mirrors the choice to the operating system; the
 * row says so, in words, when the computer does not match what was saved.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { LoginItemStatus } from '@shared/ipc'
import type { StartWithComputer } from '@shared/types'
import i18n from '../i18n'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import { loginItemProblem } from '../queries/loginItem'
import SettingsView from './SettingsView'

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
)
vi.mock('../hooks/useUpdater', () => ({
  useUpdater: () => ({
    state: {
      state: 'idle',
      currentVersion: '1.0.0',
      availableVersion: null,
      progressPercent: 0,
      failure: null
    },
    check: vi.fn(() => Promise.resolve()),
    download: vi.fn(),
    install: vi.fn()
  })
}))

const msg = (key: string): string => i18n.t(key)
let getLoginItem: ReturnType<typeof vi.fn<() => Promise<LoginItemStatus>>>

function renderAbout(choice: StartWithComputer = 'off'): void {
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, startWithComputer: choice },
    dirty: false,
    saving: false
  })
  useUiStore.setState({ settingsCategory: 'about' })
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SettingsView />
    </QueryClientProvider>
  )
}

const group = (): HTMLElement =>
  screen.getByRole('radiogroup', { name: msg('settings.startWithComputer.aria') })
const problem = (): string | null =>
  document.querySelector('[data-login-item-problem]')?.textContent ?? null

beforeEach(() => {
  getLoginItem = vi.fn<() => Promise<LoginItemStatus>>(async () => 'off')
  ;(window as unknown as { vrx?: unknown }).vrx = { getLoginItem }
})

afterEach(() => {
  cleanup()
  ;(window as unknown as { vrx?: unknown }).vrx = undefined
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false, saving: false })
  useUiStore.setState({ settingsCategory: 'appearance' })
})

describe('Settings → About: Start with your computer', () => {
  it('is Off by default, with the three choices as words', () => {
    renderAbout()
    const radios = within(group()).getAllByRole('radio')
    expect(radios.map((radio) => radio.textContent)).toEqual([
      msg('settings.startWithComputer.off'),
      msg('settings.startWithComputer.window'),
      msg('settings.startWithComputer.tray')
    ])
    expect(radios[0]!.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(msg('settings.startWithComputer.description'))).toBeTruthy()
  })

  it('saves each choice as the one setting', () => {
    renderAbout()
    fireEvent.click(
      within(group()).getByRole('radio', { name: msg('settings.startWithComputer.tray') })
    )
    expect(useSettingsStore.getState().settings.startWithComputer).toBe('tray')
    expect(useSettingsStore.getState().dirty).toBe(true)
    fireEvent.click(
      within(group()).getByRole('radio', { name: msg('settings.startWithComputer.window') })
    )
    expect(useSettingsStore.getState().settings.startWithComputer).toBe('window')
    fireEvent.click(
      within(group()).getByRole('radio', { name: msg('settings.startWithComputer.off') })
    )
    expect(useSettingsStore.getState().settings.startWithComputer).toBe('off')
  })

  it('says nothing extra when the computer matches the saved choice', async () => {
    getLoginItem.mockResolvedValue('on')
    renderAbout('window')
    await waitFor(() => expect(getLoginItem).toHaveBeenCalled())
    await act(async () => {})
    expect(problem()).toBe('')
    expect(screen.getByText(msg('settings.startWithComputer.description'))).toBeTruthy()
  })

  it.each([
    ['window', 'off', 'settings.startWithComputer.notApplied'],
    ['tray', 'off', 'settings.startWithComputer.notApplied'],
    ['off', 'on', 'settings.startWithComputer.stillOn'],
    ['window', 'unavailable', 'settings.startWithComputer.unavailable']
  ] as const)(
    'with %s saved and the computer at %s, says so in place of the description',
    async (choice, status, key) => {
      getLoginItem.mockResolvedValue(status)
      renderAbout(choice)
      await waitFor(() => expect(problem()).toBe(msg(key)))
      expect(screen.queryByText(msg('settings.startWithComputer.description'))).toBeNull()
    }
  )

  it('does not call a copy that cannot register a problem while the choice is Off', async () => {
    getLoginItem.mockResolvedValue('unavailable')
    renderAbout('off')
    await waitFor(() => expect(getLoginItem).toHaveBeenCalled())
    await act(async () => {})
    expect(problem()).toBe('')
  })

  it('waits for the save before asking, so it never judges an unsaved choice', async () => {
    renderAbout('off')
    await waitFor(() => expect(getLoginItem).toHaveBeenCalledTimes(1))
    fireEvent.click(
      within(group()).getByRole('radio', { name: msg('settings.startWithComputer.window') })
    )
    await act(async () => {})
    // Unsaved: no new read, and no verdict about the old answer.
    expect(getLoginItem).toHaveBeenCalledTimes(1)
    expect(problem()).toBe('')
    getLoginItem.mockResolvedValue('on')
    act(() => useSettingsStore.getState().markSaved())
    await waitFor(() => expect(getLoginItem).toHaveBeenCalledTimes(2))
    await act(async () => {})
    expect(problem()).toBe('')
  })

  it('shows the refusal after a save the computer did not take', async () => {
    renderAbout('off')
    await waitFor(() => expect(getLoginItem).toHaveBeenCalledTimes(1))
    fireEvent.click(
      within(group()).getByRole('radio', { name: msg('settings.startWithComputer.tray') })
    )
    act(() => useSettingsStore.getState().markSaved())
    await waitFor(() => expect(problem()).toBe(msg('settings.startWithComputer.notApplied')))
  })

  it('reads an unknown or failing answer as nothing to say', async () => {
    getLoginItem.mockResolvedValue('sideways' as LoginItemStatus)
    renderAbout('window')
    await waitFor(() => expect(getLoginItem).toHaveBeenCalled())
    await act(async () => {})
    expect(problem()).toBe('')
    cleanup()
    getLoginItem.mockRejectedValue(new Error('ipc'))
    renderAbout('window')
    await act(async () => {})
    expect(problem()).toBe('')
  })

  it('is not on the Behavior page, which has no room left', () => {
    renderAbout()
    act(() => useUiStore.setState({ settingsCategory: 'behavior' }))
    expect(
      screen.queryByRole('radiogroup', { name: msg('settings.startWithComputer.aria') })
    ).toBeNull()
  })
})

describe('loginItemProblem', () => {
  it('compares the saved choice with the computer', () => {
    expect(loginItemProblem('off', 'off')).toBeNull()
    expect(loginItemProblem('window', 'on')).toBeNull()
    expect(loginItemProblem('tray', 'on')).toBeNull()
    expect(loginItemProblem('tray', 'off')).toBe('not-applied')
    expect(loginItemProblem('off', 'on')).toBe('still-on')
    expect(loginItemProblem('window', 'unavailable')).toBe('unavailable')
    expect(loginItemProblem('off', 'unavailable')).toBeNull()
    expect(loginItemProblem('window', null)).toBeNull()
  })
})
