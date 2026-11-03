// @vitest-environment jsdom
/**
 * Unfriend, Block and Unblock at the foot of a full profile (owner,
 * 2026-11-01): nothing is read before the press, every change needs a modal
 * confirmation that starts on Cancel, one press sends one change for one
 * person, and both platforms get the same buttons in the same order.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type {
  Relationship,
  RelationshipResult,
  SocialAction,
  SocialActionResult
} from '@shared/socialActions'
import type { AuthStatus, Platform } from '@shared/types'
import i18n from '../i18n'
import ProfileActions from './ProfileActions'

vi.mock('../queries/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/auth')>()),
  useAuthStatus: (platform: Platform) => {
    const data: AuthStatus = {
      platform,
      state: 'authenticated',
      accountId: `${platform}-me`,
      displayName: 'Me'
    }
    return { data, isSuccess: true, isFetching: false, isPending: false }
  }
}))

const msg = (key: string, opts?: Record<string, unknown>): string => i18n.t(key, opts)
const IDS: Record<Platform, string> = {
  vrchat: 'usr_5a3c1e2d-0000-4000-8000-000000000001',
  chilloutvr: '5a3c1e2d-0000-4000-8000-000000000002'
}
const NAMES: Record<Platform, string> = { vrchat: 'VRChat', chilloutvr: 'ChilloutVR' }

let state: Pick<Relationship, 'isFriend' | 'blocked'>
const bridge = {
  getRelationship: vi.fn(
    ({ platform, userId }: { platform: Platform; userId: string }): Promise<RelationshipResult> =>
      Promise.resolve({ ok: true, relationship: { platform, userId, ...state } })
  ),
  socialAction: vi.fn(
    ({
      platform,
      userId,
      action
    }: {
      platform: Platform
      userId: string
      action: SocialAction
    }): Promise<SocialActionResult> => {
      if (action === 'unfriend') state = { ...state, isFriend: false }
      else state = { ...state, blocked: action === 'block' }
      return Promise.resolve({ ok: true, relationship: { platform, userId, ...state } })
    }
  ),
  onIdentityBoundary: vi.fn(() => () => undefined),
  onFriendEvent: vi.fn(() => () => undefined)
}

function renderActions(platform: Platform = 'vrchat'): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ProfileActions platform={platform} userId={IDS[platform]} name="Lumen" />
    </QueryClientProvider>
  )
  return client
}

async function openOptions(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: msg('profile.actions.show') }))
  await screen.findByRole('button', { name: msg('profile.actions.block') })
}

function actionButtons(): string[] {
  return Array.from(document.querySelectorAll('[data-social-action]')).map(
    (button) => button.getAttribute('data-social-action') ?? ''
  )
}

beforeEach(() => {
  state = { isFriend: true, blocked: false }
  Object.defineProperty(window, 'vrx', { value: bridge, configurable: true, writable: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  Reflect.deleteProperty(window, 'vrx')
})

describe('ProfileActions', () => {
  it.each(['vrchat', 'chilloutvr'] as const)(
    'reads nothing until pressed, then offers the same actions on %s',
    async (platform) => {
      renderActions(platform)
      expect(bridge.getRelationship).not.toHaveBeenCalled()
      await openOptions()
      expect(bridge.getRelationship).toHaveBeenCalledTimes(1)
      expect(bridge.getRelationship).toHaveBeenCalledWith({ platform, userId: IDS[platform] })
      expect(actionButtons()).toEqual(['unfriend', 'block'])
      expect(
        screen.getByText(msg('profile.actions.hint', { platform: NAMES[platform] }))
      ).toBeTruthy()
    }
  )

  it('shows Unblock for a blocked person, no Unfriend for a non-friend, and both when unsure', async () => {
    state = { isFriend: false, blocked: true }
    renderActions()
    fireEvent.click(screen.getByRole('button', { name: msg('profile.actions.show') }))
    await screen.findByRole('button', { name: msg('profile.actions.unblock') })
    expect(actionButtons()).toEqual(['unblock'])
    cleanup()

    state = { isFriend: false, blocked: null }
    renderActions('chilloutvr')
    await openOptions()
    expect(actionButtons()).toEqual(['block', 'unblock'])
    expect(screen.getByText(msg('profile.actions.unknownBlock'))).toBeTruthy()
  })

  it('names only blocking on a profile that is not a friend', async () => {
    state = { isFriend: false, blocked: false }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ProfileActions platform="vrchat" userId={IDS.vrchat} name="Lumen" notFriend />
      </QueryClientProvider>
    )
    expect(screen.queryByRole('button', { name: msg('profile.actions.show') })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: msg('profile.actions.showBlock') }))
    await screen.findByRole('button', { name: msg('profile.actions.block') })
    expect(actionButtons()).toEqual(['block'])
    expect(screen.getByRole('button', { name: msg('profile.actions.hideBlock') })).toBeTruthy()
  })

  it('confirms in a modal that starts on Cancel and sends nothing when cancelled', async () => {
    renderActions()
    await openOptions()
    fireEvent.click(screen.getByRole('button', { name: msg('profile.actions.unfriend') }))

    const dialog = screen.getByRole('alertdialog', {
      name: msg('profile.actions.confirm.title.unfriend', { name: 'Lumen' })
    })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: msg('profile.actions.confirm.cancel') })
    )
    expect(within(dialog).getByText('VRChat')).toBeTruthy()

    fireEvent.click(
      within(dialog).getByRole('button', { name: msg('profile.actions.confirm.cancel') })
    )
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(bridge.socialAction).not.toHaveBeenCalled()
  })

  it('closes an open question, sending nothing, when the drawer or sheet around it closes', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const actions = (panelOpen: boolean): React.JSX.Element => (
      <QueryClientProvider client={client}>
        <ProfileActions platform="vrchat" userId={IDS.vrchat} name="Lumen" panelOpen={panelOpen} />
      </QueryClientProvider>
    )
    const view = render(actions(true))
    await openOptions()
    fireEvent.click(screen.getByRole('button', { name: msg('profile.actions.unfriend') }))
    expect(screen.getByRole('alertdialog')).toBeTruthy()

    // Friend details close on their own when the friend leaves the list.
    view.rerender(actions(false))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    // Opening the same friend again does not bring the old question back.
    view.rerender(actions(true))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(bridge.socialAction).not.toHaveBeenCalled()
  })

  it('keeps Escape and outside presses from reaching the drawer or sheet behind it', async () => {
    const documentKeys = vi.fn()
    const documentPointers = vi.fn()
    document.addEventListener('keydown', documentKeys)
    document.addEventListener('pointerdown', documentPointers)
    try {
      renderActions()
      await openOptions()
      fireEvent.click(screen.getByRole('button', { name: msg('profile.actions.block') }))
      const dialog = screen.getByRole('alertdialog')
      fireEvent.pointerDown(dialog)
      fireEvent.keyDown(dialog, { key: 'Escape' })
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(documentKeys).not.toHaveBeenCalled()
      expect(documentPointers).not.toHaveBeenCalled()
      expect(bridge.socialAction).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', documentKeys)
      document.removeEventListener('pointerdown', documentPointers)
    }
  })

  it('sends one change for one person and then shows the new state', async () => {
    renderActions('chilloutvr')
    await openOptions()
    fireEvent.click(screen.getByRole('button', { name: msg('profile.actions.block') }))
    const confirm = within(screen.getByRole('alertdialog')).getByRole('button', {
      name: msg('profile.actions.block')
    })
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    await screen.findByText(msg('profile.actions.done.block', { platform: 'ChilloutVR' }))
    expect(bridge.socialAction).toHaveBeenCalledTimes(1)
    expect(bridge.socialAction).toHaveBeenCalledWith({
      platform: 'chilloutvr',
      userId: IDS.chilloutvr,
      action: 'block'
    })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(actionButtons()).toEqual(['unfriend', 'unblock']))
    // The answer replaced the cached state; no second read.
    expect(bridge.getRelationship).toHaveBeenCalledTimes(1)
  })

  it('keeps the dialog open with the reason when the platform refuses', async () => {
    bridge.socialAction.mockResolvedValueOnce({ ok: false, reason: 'not-connected' })
    renderActions('chilloutvr')
    await openOptions()
    fireEvent.click(screen.getByRole('button', { name: msg('profile.actions.unfriend') }))
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: msg('profile.actions.unfriend')
      })
    )
    expect(
      await screen.findByText(
        msg('profile.actions.error.not-connected', { platform: 'ChilloutVR' })
      )
    ).toBeTruthy()
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(actionButtons()).toEqual(['unfriend', 'block'])
  })

  it('keeps focus on the pressed button while it sends and after a refusal', async () => {
    let answer: (result: SocialActionResult) => void = () => undefined
    bridge.socialAction.mockImplementationOnce(
      () => new Promise<SocialActionResult>((resolve) => (answer = resolve))
    )
    renderActions()
    await openOptions()
    fireEvent.click(screen.getByRole('button', { name: msg('profile.actions.block') }))
    const dialog = screen.getByRole('alertdialog')
    const confirm = within(dialog).getByRole('button', { name: msg('profile.actions.block') })
    const cancel = within(dialog).getByRole('button', {
      name: msg('profile.actions.confirm.cancel')
    })
    confirm.focus()
    fireEvent.click(confirm)

    // aria-disabled, not disabled: Chromium drops focus from a disabled
    // button to the page behind the dialog; jsdom doesn't.
    await screen.findByRole('button', { name: msg('profile.actions.confirm.sending') })
    expect(confirm.hasAttribute('disabled')).toBe(false)
    expect(confirm.getAttribute('aria-disabled')).toBe('true')
    expect(cancel.hasAttribute('disabled')).toBe(false)
    expect(cancel.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(confirm)
    // Another press, such as a double-click's second, lands on the button and
    // not on the panel under it, which would take focus. jsdom doesn't
    // hit-test, so check that the dimmed buttons keep pointer events.
    for (const button of [confirm, cancel]) {
      expect(button.className).not.toContain('pointer-events-none')
    }
    // Presses while it sends do nothing.
    fireEvent.click(cancel)
    fireEvent.click(confirm)
    expect(screen.getByRole('alertdialog')).toBe(dialog)
    expect(bridge.socialAction).toHaveBeenCalledTimes(1)

    answer({ ok: false, reason: 'unavailable' })
    await screen.findByRole('alert')
    expect(document.activeElement).toBe(confirm)
    expect(confirm.hasAttribute('aria-disabled')).toBe(false)
    expect(cancel.hasAttribute('aria-disabled')).toBe(false)
  })

  it('keeps Tab in the dialog when focus is on the dialog itself, as after a press on its text', async () => {
    renderActions()
    await openOptions()
    fireEvent.click(screen.getByRole('button', { name: msg('profile.actions.unfriend') }))
    const dialog = screen.getByRole('alertdialog')
    const cancel = within(dialog).getByRole('button', {
      name: msg('profile.actions.confirm.cancel')
    })
    for (const shiftKey of [true, false]) {
      dialog.focus()
      expect(fireEvent.keyDown(dialog, { key: 'Tab', shiftKey })).toBe(false)
      expect(document.activeElement).toBe(cancel)
    }
  })

  it.each(['touch', 'pen'])(
    'closes on a %s tap’s click, not its press, so the tap stays on the scrim',
    async (pointerType) => {
      renderActions()
      await openOptions()
      fireEvent.click(screen.getByRole('button', { name: msg('profile.actions.unfriend') }))
      const scrim = screen.getByTestId('social-confirm-scrim')
      fireEvent.pointerDown(scrim, { pointerType })
      // Still there for the tap's click, which would otherwise land behind it.
      expect(screen.getByRole('alertdialog')).toBeTruthy()
      fireEvent.pointerUp(scrim, { pointerType })
      fireEvent.click(scrim)

      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(bridge.socialAction).not.toHaveBeenCalled()
    }
  )

  it('offers Retry when the check fails', async () => {
    bridge.getRelationship.mockResolvedValueOnce({ ok: false, reason: 'unavailable' })
    renderActions()
    fireEvent.click(screen.getByRole('button', { name: msg('profile.actions.show') }))
    expect(await screen.findByText(msg('profile.actions.checkError'))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: msg('community.retry') }))
    await screen.findByRole('button', { name: msg('profile.actions.block') })
    expect(bridge.getRelationship).toHaveBeenCalledTimes(2)
  })
  it('offers Accounts, not Retry, when the check asks to sign in again', async () => {
    bridge.getRelationship.mockResolvedValueOnce({ ok: false, reason: 'not-authenticated' })
    renderActions()
    fireEvent.click(screen.getByRole('button', { name: msg('profile.actions.show') }))
    expect(
      await screen.findByText(
        msg('profile.actions.error.not-authenticated', { platform: 'VRChat' })
      )
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: msg('community.retry') })).toBeNull()
    expect(screen.getByRole('button', { name: msg('community.openAccounts') })).toBeTruthy()
    expect(bridge.getRelationship).toHaveBeenCalledTimes(1)
  })

  it('keeps the new state when an older check answers after the change', async () => {
    const client = renderActions('chilloutvr')
    await openOptions()
    let answer: (value: RelationshipResult) => void = () => undefined
    bridge.getRelationship.mockImplementationOnce(
      ({ platform, userId }) =>
        new Promise<RelationshipResult>((resolve) => {
          const before = { platform, userId, ...state }
          answer = () => resolve({ ok: true, relationship: before })
        })
    )
    void client.refetchQueries({ queryKey: ['relationship', 'chilloutvr'] })
    await waitFor(() => expect(bridge.getRelationship).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: msg('profile.actions.block') }))
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: msg('profile.actions.block')
      })
    )
    await screen.findByText(msg('profile.actions.done.block', { platform: 'ChilloutVR' }))
    answer({ ok: true, relationship: { platform: 'chilloutvr', userId: '', ...state } })
    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect(actionButtons()).toEqual(['unfriend', 'unblock'])
  })
})
