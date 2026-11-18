// @vitest-environment jsdom
/**
 * Dashboard Quick launch (owner, 2026-11-18): one button per platform that
 * starts the game without joining anyone. Both platforms get the same button;
 * the press names the platform and nothing else, and every answer shows in
 * words and clears itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { GameLaunchResult } from '@shared/ipc'
import type { AuthState, AuthStatus, Platform } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { translate as msg } from '../i18n/translate'
import { useSettingsStore } from '../stores/settings'
import DashboardQuickLaunch, {
  QUICK_LAUNCH_NOTICE_MS,
  QUICK_LAUNCH_STARTING_MS
} from './DashboardQuickLaunch'

const authState = vi.hoisted((): Record<'vrchat' | 'chilloutvr', string> => ({
  vrchat: 'authenticated',
  chilloutvr: 'authenticated'
}))
vi.mock('../queries/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/auth')>()),
  useAuthStatus: (platform: Platform) => {
    const state = authState[platform] as AuthState
    const data: AuthStatus = {
      platform,
      state,
      accountId: state === 'authenticated' ? `${platform}-me` : null,
      displayName: state === 'authenticated' ? 'Me' : null
    }
    return { data }
  }
}))

const BOTH: Platform[] = ['vrchat', 'chilloutvr']
const name = (platform: Platform): string =>
  msg(platform === 'vrchat' ? 'dashboard.platformVrc' : 'dashboard.platformCvr')
const label = (key: string, platform: Platform): string =>
  msg(`dashboard.quickLaunch.${key}`, { platform: name(platform) })
const launchButton = (platform: Platform): HTMLElement =>
  screen.getByRole('button', { name: label('launch', platform) })

const launchGame = vi.fn<(req: { platform: Platform }) => Promise<GameLaunchResult>>()

/** Let the bridge's answer land. */
const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  launchGame.mockReset().mockResolvedValue({ ok: true, state: 'started' })
  Object.defineProperty(window, 'vrx', {
    value: { launchGame },
    configurable: true,
    writable: true
  })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  authState.vrchat = 'authenticated'
  authState.chilloutvr = 'authenticated'
  Reflect.deleteProperty(window, 'vrx')
})

describe('DashboardQuickLaunch: what shows', () => {
  it('shows one button per platform, the same shape, each named in words', () => {
    render(<DashboardQuickLaunch platforms={BOTH} />)
    const section = screen.getByRole('region', { name: msg('dashboard.quickLaunch.heading') })
    const vrc = launchButton('vrchat')
    const cvr = launchButton('chilloutvr')
    expect(section.contains(vrc) && section.contains(cvr)).toBe(true)
    // Same classes on both buttons; only the row's platform tint differs.
    expect(vrc.className).toBe(cvr.className)
    expect(vrc.closest('li')?.className).toBe('platform-row platform-row--vrchat')
    expect(cvr.closest('li')?.className).toBe('platform-row platform-row--chilloutvr')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('follows the platform filter', () => {
    render(<DashboardQuickLaunch platforms={['chilloutvr']} />)
    expect(launchButton('chilloutvr')).toBeTruthy()
    expect(screen.queryByRole('button', { name: label('launch', 'vrchat') })).toBeNull()
  })

  it('leaves out a platform VRX has no account for, and keeps one whose check is failing', () => {
    authState.vrchat = 'error'
    authState.chilloutvr = 'unauthenticated'
    render(<DashboardQuickLaunch platforms={BOTH} />)
    expect(launchButton('vrchat')).toBeTruthy()
    expect(screen.queryByRole('button', { name: label('launch', 'chilloutvr') })).toBeNull()
  })

  it('shows nothing when switched off, or when no platform has a button', () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, dashboardQuickLaunch: false } })
    const off = render(<DashboardQuickLaunch platforms={BOTH} />)
    expect(off.container.innerHTML).toBe('')
    off.unmount()

    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } })
    authState.vrchat = 'needs-2fa'
    authState.chilloutvr = 'unauthenticated'
    const none = render(<DashboardQuickLaunch platforms={BOTH} />)
    expect(none.container.innerHTML).toBe('')
  })
})

describe('DashboardQuickLaunch: pressing', () => {
  it.each(BOTH)('asks main to start %s, naming only the platform', async (platform) => {
    render(<DashboardQuickLaunch platforms={BOTH} />)
    fireEvent.click(launchButton(platform))
    expect(launchGame).toHaveBeenCalledExactlyOnceWith({ platform })
    // The press is answered at once, in words, and the other button is untouched.
    const starting = screen.getByRole('button', { name: label('starting', platform) })
    expect(starting.getAttribute('aria-disabled')).toBe('true')
    expect(launchButton(platform === 'vrchat' ? 'chilloutvr' : 'vrchat')).toBeTruthy()
    await settle()

    // A second press while it starts sends nothing more.
    fireEvent.click(starting)
    expect(launchGame).toHaveBeenCalledOnce()

    act(() => {
      vi.advanceTimersByTime(QUICK_LAUNCH_STARTING_MS)
    })
    expect(launchButton(platform).getAttribute('aria-disabled')).toBeNull()
  })

  it('says so when the game is already open, then goes back to Launch', async () => {
    launchGame.mockResolvedValue({ ok: true, state: 'already-open' })
    render(<DashboardQuickLaunch platforms={BOTH} />)
    fireEvent.click(launchButton('chilloutvr'))
    await settle()
    expect(screen.getByRole('status').textContent).toBe(label('alreadyOpen', 'chilloutvr'))
    expect(screen.queryByRole('alert')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(QUICK_LAUNCH_NOTICE_MS - 1)
    })
    expect(screen.getByRole('status').textContent).toBe(label('alreadyOpen', 'chilloutvr'))
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(launchButton('chilloutvr')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('keeps saying Starting when main was asked moments ago', async () => {
    launchGame.mockResolvedValue({ ok: true, state: 'starting' })
    render(<DashboardQuickLaunch platforms={BOTH} />)
    fireEvent.click(launchButton('vrchat'))
    await settle()
    expect(screen.getByRole('status').textContent).toBe(label('starting', 'vrchat'))
  })

  it.each<[string, () => Promise<GameLaunchResult>, string]>([
    ['a failed start', () => Promise.resolve({ ok: false, reason: 'launch-failed' }), 'failed'],
    ['a lost answer', () => Promise.reject(new Error('gone')), 'failed'],
    ['a Join in the way', () => Promise.resolve({ ok: false, reason: 'cooldown' }), 'busy'],
    ['too many presses', () => Promise.resolve({ ok: false, reason: 'rate-limited' }), 'busy']
  ])('explains %s, frees the button, and clears the line by itself', async (_case, answer, key) => {
    launchGame.mockImplementation(answer)
    render(<DashboardQuickLaunch platforms={BOTH} />)
    fireEvent.click(launchButton('vrchat'))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(label(key, 'vrchat'))
    // The button is ready for another try straight away.
    expect(launchButton('vrchat').getAttribute('aria-disabled')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(QUICK_LAUNCH_NOTICE_MS)
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('clears a failure line when that platform is tried again', async () => {
    launchGame.mockResolvedValueOnce({ ok: false, reason: 'launch-failed' })
    render(<DashboardQuickLaunch platforms={BOTH} />)
    fireEvent.click(launchButton('vrchat'))
    await settle()
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.click(launchButton('vrchat'))
    expect(screen.queryByRole('alert')).toBeNull()
    await settle()
    expect(screen.getByRole('status').textContent).toBe(label('starting', 'vrchat'))
  })

  it('does nothing without the bridge, and nothing after it unmounts', async () => {
    let answer: (result: GameLaunchResult) => void = () => undefined
    launchGame.mockImplementation(
      () =>
        new Promise<GameLaunchResult>((resolve) => {
          answer = resolve
        })
    )
    const view = render(<DashboardQuickLaunch platforms={BOTH} />)
    fireEvent.click(launchButton('vrchat'))
    view.unmount()
    answer({ ok: false, reason: 'launch-failed' })
    await settle()
    expect(vi.getTimerCount()).toBe(0)

    Reflect.deleteProperty(window, 'vrx')
    render(<DashboardQuickLaunch platforms={BOTH} />)
    fireEvent.click(launchButton('vrchat'))
    expect(launchButton('vrchat')).toBeTruthy()
  })
})
