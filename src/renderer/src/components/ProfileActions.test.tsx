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

function renderActions(platform: Platform = 'vrchat'): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ProfileActions platform={platform} userId={IDS[platform]} name="Lumen" />
    </QueryClientProvider>
  )
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

  it('offers Retry when the check fails', async () => {
    bridge.getRelationship.mockResolvedValueOnce({ ok: false, reason: 'unavailable' })
    renderActions()
    fireEvent.click(screen.getByRole('button', { name: msg('profile.actions.show') }))
    expect(await screen.findByText(msg('profile.actions.checkError'))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: msg('community.retry') }))
    await screen.findByRole('button', { name: msg('profile.actions.block') })
    expect(bridge.getRelationship).toHaveBeenCalledTimes(2)
  })
})
