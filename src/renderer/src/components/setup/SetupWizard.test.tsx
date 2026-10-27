// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { AuthState, Platform } from '@shared/types'
import i18n from '../../i18n'
import { useSettingsStore } from '../../stores/settings'
import { useUiStore } from '../../stores/ui'
import SetupWizard from './SetupWizard'

// jsdom has no ResizeObserver; the segmented controls' bubble hook needs one.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
)

const msg = (key: string, options?: Record<string, unknown>): string => i18n.t(key, options)

function setBridge(states: Record<Platform, AuthState>): void {
  ;(window as unknown as { vrx?: unknown }).vrx = {
    getAuthStatus: vi.fn(({ platform }: { platform: Platform }) =>
      Promise.resolve({
        platform,
        state: states[platform],
        accountId: states[platform] === 'authenticated' ? `${platform}-owner` : null,
        displayName: states[platform] === 'authenticated' ? 'Nova' : null
      })
    ),
    login: vi.fn(),
    verify2fa: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined)
  }
}

function renderWizard(states: Record<Platform, AuthState>): void {
  setBridge(states)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <SetupWizard />
    </QueryClientProvider>
  )
}

const signedIn = { vrchat: 'authenticated', chilloutvr: 'unauthenticated' } as const
const signedOut = { vrchat: 'unauthenticated', chilloutvr: 'unauthenticated' } as const

const button = (key: string): HTMLElement => screen.getByRole('button', { name: msg(key) })
const settings = (): typeof DEFAULT_SETTINGS => useSettingsStore.getState().settings

async function goToSignIn(): Promise<void> {
  fireEvent.click(button('setup.getStarted'))
  await screen.findByRole('heading', { name: msg('setup.signin.title') })
}

beforeEach(() => {
  useSettingsStore.getState().setSettings({ ...DEFAULT_SETTINGS, setupPending: true })
  useSettingsStore.getState().hydrate()
  useUiStore.getState().setActiveTab('settings')
})

afterEach(() => {
  cleanup()
  ;(window as unknown as { vrx?: unknown }).vrx = undefined
})

describe('SetupWizard', () => {
  it('keeps the fine print short and puts the full text behind Show more', async () => {
    renderWizard(signedOut)
    // Welcome: one short notice, with no Show more (the full legal text is in
    // Settings → About).
    expect(screen.getByText(msg('shell.unofficialNotice'))).toBeTruthy()
    expect(screen.queryByRole('button', { name: msg('setup.showMore') })).toBeNull()

    // Sign in: the storage detail starts hidden too.
    await goToSignIn()
    const storageFull = msg('setup.signin.storageFull')
    expect(screen.getByText(msg('setup.signin.storage'))).toBeTruthy()
    expect(screen.queryByText(storageFull)).toBeNull()
    fireEvent.click(button('setup.showMore'))
    expect(screen.getByText(storageFull)).toBeTruthy()
  })

  it('offers a real Skip setup button on every step before the summary', async () => {
    renderWizard(signedIn)
    expect(screen.getByRole('heading', { name: msg('setup.welcome.title') })).toBeTruthy()
    expect(button('setup.skip')).toBeTruthy()
    await goToSignIn()
    await screen.findByText(msg('setup.signin.one'))
    for (const title of [
      'setup.pages.title',
      'setup.dashboard.title',
      'setup.alerts.title',
      'setup.look.title'
    ]) {
      fireEvent.click(button('setup.continue'))
      expect(screen.getByRole('heading', { name: msg(title) })).toBeTruthy()
      expect(button('setup.skip')).toBeTruthy()
    }
    fireEvent.click(button('setup.continue'))
    expect(screen.getByRole('heading', { name: msg('setup.done.title') })).toBeTruthy()
    expect(screen.queryByRole('button', { name: msg('setup.skip') })).toBeNull()
  })

  it('skipping with an account ready finishes at once, keeps defaults and opens the Dashboard', async () => {
    renderWizard(signedIn)
    await goToSignIn()
    await screen.findByText(msg('setup.signin.one'))
    fireEvent.click(button('setup.skip'))
    expect(settings()).toEqual({ ...DEFAULT_SETTINGS, setupPending: false })
    // Leaving setup early keeps the VRChat instance labels.
    expect(settings().labelScheme).toBe('vrchat')
    expect(useUiStore.getState().activeTab).toBe('dashboard')
  })

  it('skipping before sign-in goes to sign-in only, and cannot open VRX without an account', async () => {
    renderWizard(signedOut)
    fireEvent.click(button('setup.skip'))
    await screen.findByText(msg('setup.signin.skipLead'))
    // No progress bar or second Skip: the next stop after sign-in is the app.
    expect(screen.queryByRole('navigation', { name: msg('setup.progress.aria') })).toBeNull()
    expect(screen.queryByRole('button', { name: msg('setup.skip') })).toBeNull()
    const open = button('setup.finish') as HTMLButtonElement
    expect(open.disabled).toBe(true)
    fireEvent.click(open)
    expect(settings().setupPending).toBe(true)
    // Back returns to the full setup.
    fireEvent.click(button('setup.back'))
    expect(screen.getByRole('heading', { name: msg('setup.welcome.title') })).toBeTruthy()
  })

  it('requires one ready account to continue past sign-in', async () => {
    renderWizard(signedOut)
    await goToSignIn()
    await screen.findByText(msg('setup.signin.lead'))
    expect((button('setup.continue') as HTMLButtonElement).disabled).toBe(true)
    // Both sign-in cards show, side by side, as in Settings → Accounts.
    expect(screen.getAllByLabelText(msg('settings.accounts.password'))).toHaveLength(2)
  })

  it('treats an unreachable but live session as ready, like the app gate does', async () => {
    renderWizard({ vrchat: 'unauthenticated', chilloutvr: 'error' })
    await goToSignIn()
    await screen.findByText(msg('setup.signin.one'))
    expect((button('setup.continue') as HTMLButtonElement).disabled).toBe(false)
  })

  it('writes each choice straight to settings and summarizes it before opening VRX', async () => {
    renderWizard(signedIn)
    await goToSignIn()
    await screen.findByText(msg('setup.signin.one'))

    fireEvent.click(button('setup.continue'))
    const explore = screen.getByRole('radiogroup', { name: msg('setup.pages.exploreAria') })
    fireEvent.click(within(explore).getByRole('radio', { name: msg('settings.boolean.off') }))
    expect(settings().showExplorePage).toBe(false)
    const activity = screen.getByRole('radiogroup', { name: msg('setup.pages.activityAria') })
    fireEvent.click(within(activity).getByRole('radio', { name: msg('settings.boolean.off') }))
    expect(settings().showActivityPage).toBe(false)
    fireEvent.click(within(activity).getByRole('radio', { name: msg('settings.boolean.on') }))
    expect(settings().showActivityPage).toBe(true)

    fireEvent.click(button('setup.continue'))
    expect(
      screen.getByRole('radiogroup', { name: msg('settings.dashboard.order.aria') })
    ).toBeTruthy()
    const hot = screen.getByRole('radiogroup', { name: msg('setup.dashboard.hotAria') })
    fireEvent.click(within(hot).getByRole('radio', { name: msg('settings.boolean.off') }))
    expect(settings().hotInstancesEnabled).toBe(false)
    // The order only matters while both sections show.
    expect(
      screen.queryByRole('radiogroup', { name: msg('settings.dashboard.order.aria') })
    ).toBeNull()

    fireEvent.click(button('setup.continue'))
    fireEvent.click(button('setup.alerts.allOn'))
    expect(settings()).toMatchObject({
      notifyFriendOnline: true,
      notifyFriendInGame: true,
      notifyFriendOffline: true,
      notifyHotInstance: true
    })
    expect(button('setup.alerts.allOff')).toBeTruthy()

    fireEvent.click(button('setup.continue'))
    const themes = screen.getByRole('radiogroup', { name: msg('setup.look.aria') })
    const system = within(themes).getByRole('radio', { name: msg('setup.look.system') })
    expect(system.getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(system, { key: 'ArrowRight' })
    expect(settings().theme).toBe('dark')
    fireEvent.click(within(themes).getByRole('radio', { name: msg('settings.theme.light') }))
    expect(settings().theme).toBe('light')
    // Instance labels are asked too, starting on the VRChat default.
    const labels = screen.getByRole('radiogroup', { name: msg('settings.labelScheme.aria') })
    expect(
      within(labels)
        .getByRole('radio', { name: msg('settings.labelScheme.vrchat') })
        .getAttribute('aria-checked')
    ).toBe('true')
    fireEvent.click(
      within(labels).getByRole('radio', { name: msg('settings.labelScheme.platformNative') })
    )
    expect(settings().labelScheme).toBe('platform-native')

    fireEvent.click(button('setup.continue'))
    const summary = screen.getByRole('heading', { name: msg('setup.done.title') }).parentElement
      ?.parentElement as HTMLElement
    // Hot Instances is off, so the Dashboard shows Popular now alone.
    expect(within(summary).getByText(msg('settings.dashboard.popular.label'))).toBeTruthy()
    expect(
      within(summary).getByText(
        [
          msg('shell.nav.dashboard'),
          msg('shell.nav.hot'),
          msg('shell.nav.friends'),
          msg('shell.nav.activity'),
          msg('shell.nav.settings')
        ].join(', ')
      )
    ).toBeTruthy()
    expect(
      within(summary).getByText(msg('setup.done.alertsSome', { count: 4, total: 4 }))
    ).toBeTruthy()
    expect(within(summary).getByText(msg('settings.labelScheme.platformNative'))).toBeTruthy()

    fireEvent.click(button('setup.finish'))
    expect(settings()).toMatchObject({
      setupPending: false,
      showExplorePage: false,
      hotInstancesEnabled: false,
      theme: 'light',
      labelScheme: 'platform-native'
    })
    expect(useUiStore.getState().activeTab).toBe('dashboard')
  })

  it('lets finished steps be revisited from the progress bar but not later ones', async () => {
    renderWizard(signedIn)
    await goToSignIn()
    await screen.findByText(msg('setup.signin.one'))
    fireEvent.click(button('setup.continue'))
    const progress = screen.getByRole('navigation', { name: msg('setup.progress.aria') })
    const look = within(progress).getByRole('button', { name: msg('setup.steps.look') })
    expect((look as HTMLButtonElement).disabled).toBe(true)
    expect(
      within(progress)
        .getByRole('button', { name: msg('setup.steps.pages') })
        .getAttribute('aria-current')
    ).toBe('step')
    fireEvent.click(
      within(progress).getByRole('button', {
        name: msg('setup.progress.done', { step: msg('setup.steps.signin') })
      })
    )
    expect(screen.getByRole('heading', { name: msg('setup.signin.title') })).toBeTruthy()
  })
})
