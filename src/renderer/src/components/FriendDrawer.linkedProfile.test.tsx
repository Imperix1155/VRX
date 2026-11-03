// @vitest-environment jsdom
/**
 * A linked person's full profile in friend details, while one of their
 * accounts leaves the friends list (an Unfriend from that account's section,
 * say): the profile stays open for the person, and keyboard focus that was in
 * the leaving section, or in its Unfriend question, lands on the toggle
 * instead of falling to the page. The star panel stays open the same way.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LinkedProfile } from '@shared/linkedProfiles'
import type { Platform } from '@shared/types'
import { fullFriend } from '../test-utils/friendFixture'
import { linkedProfilesKey } from '../queries/linkedProfiles'
import { authStatusQueryKey } from '../queries/authKey'
import { queryClient } from '../queries/queryClient'
import { resetPersonNoteCoordinatorForTests } from '../hooks/usePersonNote'
import { resolveLinkedProfile, type ProfileTarget } from '../utils/projectLinkedFriends'
import '../i18n'
import FriendDrawer from './FriendDrawer'

vi.mock('../queries/auth', () => ({
  useAuthStatus: (platform: Platform) => ({
    data: {
      platform,
      state: 'authenticated',
      accountId: platform === 'vrchat' ? 'v' : 'c',
      displayName: 'Me'
    }
  })
}))

const vrc = fullFriend('VRC', 'vrchat')
const cvr = fullFriend('CVR', 'chilloutvr')
const profile: LinkedProfile = {
  id: 'pair',
  members: [
    { platform: 'vrchat', platformAccountId: 'v', friendId: vrc.platformUserId },
    { platform: 'chilloutvr', platformAccountId: 'c', friendId: cvr.platformUserId }
  ],
  preferredPlatform: 'vrchat',
  customName: 'Together',
  defaultName: 'VRC',
  pictureMode: 'preferred',
  sharedNote: '',
  revision: 1
}
const person: ProfileTarget = {
  kind: 'person',
  personId: 'pair',
  anchor: { platform: 'vrchat', friendId: vrc.platformUserId }
}
let client: QueryClient

function drawer(friends = [vrc, cvr]): React.JSX.Element {
  const selection = resolveLinkedProfile(person, {
    friends,
    profiles: [profile],
    accountIds: { vrchat: 'v', chilloutvr: 'c' }
  })
  return (
    <QueryClientProvider client={client}>
      <FriendDrawer
        friend={selection?.header ?? null}
        selection={selection}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
      />
    </QueryClientProvider>
  )
}

function section(platform: Platform): HTMLElement {
  const friend = platform === 'vrchat' ? vrc : cvr
  const found = document.querySelector<HTMLElement>(
    `[data-profile-section="${platform}:${friend.platformUserId}"]`
  )
  if (found === null) throw new Error(`no ${platform} section`)
  return found
}

beforeEach(() => {
  resetPersonNoteCoordinatorForTests()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const snapshot = { profiles: [profile], lease: 'lease' }
  client.setQueryData(linkedProfilesKey, snapshot)
  window.vrx = {
    getLinkedProfiles: vi.fn().mockResolvedValue({ ok: true, value: snapshot }),
    changeLinkedProfile: vi.fn(),
    getFriendNote: vi.fn().mockResolvedValue({ note: '', revision: null }),
    setFriendNote: vi.fn().mockResolvedValue({ ok: true }),
    onIdentityBoundary: () => () => {},
    getAvatar: vi.fn().mockResolvedValue(null),
    getProfile: vi.fn(({ platform, userId }: { platform: Platform; userId: string }) =>
      Promise.resolve({
        ok: true,
        profile: {
          platform,
          userId,
          displayName: platform === 'vrchat' ? 'VRC' : 'CVR',
          imageUrl: null,
          isFriend: true,
          pronouns: null,
          bio: null,
          rank: null,
          badges: []
        }
      })
    ),
    getProfileWorlds: vi.fn().mockResolvedValue({ ok: true, worlds: [], complete: true }),
    getProfileGroups: vi.fn().mockResolvedValue({ ok: true, groups: [], complete: true }),
    getRelationship: vi.fn(({ platform, userId }: { platform: Platform; userId: string }) =>
      Promise.resolve({
        ok: true,
        relationship: { platform, userId, isFriend: true, blocked: false }
      })
    ),
    getFavoriteFriends: vi.fn(({ platform }: { platform: Platform }) =>
      Promise.resolve({
        friendIds: [],
        revision: { platformAccountId: platform === 'vrchat' ? 'v' : 'c', epoch: 1 }
      })
    ),
    getGameFavorites: vi.fn().mockResolvedValue({ state: 'not-authenticated' })
  } as unknown as Window['vrx']
  // The star reads who is signed in from the app's own query cache.
  for (const platform of ['vrchat', 'chilloutvr'] as const) {
    queryClient.setQueryData(authStatusQueryKey(platform), {
      platform,
      state: 'authenticated',
      accountId: platform === 'vrchat' ? 'v' : 'c',
      displayName: 'Me'
    })
  }
})

afterEach(() => {
  cleanup()
  client.clear()
  queryClient.clear()
})

/** A press as a browser makes it: the button takes focus, then the click. */
function press(button: HTMLElement): void {
  button.focus()
  fireEvent.click(button)
}

async function openFullProfile(): Promise<ReturnType<typeof render>> {
  const view = render(drawer())
  fireEvent.click(screen.getByRole('button', { name: 'Show full profile' }))
  await within(section('vrchat')).findByRole('button', { name: 'Unfriend or block' })
  await within(section('chilloutvr')).findByRole('button', { name: 'Unfriend or block' })
  return view
}

describe('a linked person’s full profile while one account leaves', () => {
  it('stays open and moves focus from the open Unfriend question to the toggle', async () => {
    const view = await openFullProfile()
    press(within(section('vrchat')).getByRole('button', { name: 'Unfriend or block' }))
    press(await within(section('vrchat')).findByRole('button', { name: 'Unfriend' }))
    const question = screen.getByRole('alertdialog')
    expect(question.contains(document.activeElement)).toBe(true)

    // VRChat's own message took that account off the list; ChilloutVR stays.
    view.rerender(drawer([cvr]))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Together')
    const toggle = screen.getByRole('button', { name: 'Hide full profile' })
    expect(document.activeElement).toBe(toggle)
    expect(
      within(section('chilloutvr')).getByRole('button', { name: 'Unfriend or block' })
    ).toBeTruthy()
  })

  it('moves focus from the question to the toggle after the window was in the background', async () => {
    const view = await openFullProfile()
    press(within(section('vrchat')).getByRole('button', { name: 'Unfriend or block' }))
    press(await within(section('vrchat')).findByRole('button', { name: 'Unfriend' }))
    const focused = document.activeElement
    if (!(focused instanceof HTMLElement)) throw new Error('nothing focused')
    expect(screen.getByRole('alertdialog').contains(focused)).toBe(true)

    // Another window takes focus: the page hears a blur, and the question
    // keeps focus for the return. Meanwhile VRChat's message removes the account.
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    try {
      fireEvent.focusOut(focused, { relatedTarget: null })
      view.rerender(drawer([cvr]))
    } finally {
      hasFocus.mockRestore()
    }
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Hide full profile' }))
  })

  it('moves focus from a control in the leaving section to the toggle', async () => {
    const view = await openFullProfile()
    within(section('vrchat')).getByRole('button', { name: 'Unfriend or block' }).focus()

    view.rerender(drawer([cvr]))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Hide full profile' }))
  })

  it('leaves focus where it is when it is in the section that stays', async () => {
    const view = await openFullProfile()
    const kept = within(section('chilloutvr')).getByRole('button', { name: 'Unfriend or block' })
    kept.focus()

    view.rerender(drawer([cvr]))
    expect(document.activeElement).toBe(kept)
    expect(kept.isConnected).toBe(true)
  })

  it('keeps the star panel open, with focus, while one account leaves', async () => {
    const view = render(drawer())
    const star = screen.getByRole('button', { name: /^Favorites for Together/ })
    press(star)
    await waitFor(() => expect(star.getAttribute('aria-expanded')).toBe('true'))
    const local = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Star in VRX (this PC only)'
    })
    await waitFor(() => expect(local.disabled).toBe(false))
    local.focus()
    expect(document.activeElement).toBe(local)

    view.rerender(drawer([cvr]))
    expect(screen.getByRole('button', { name: 'Star in VRX (this PC only)' })).toBe(local)
    expect(document.activeElement).toBe(local)
  })
})
