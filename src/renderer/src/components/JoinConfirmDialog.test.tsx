// @vitest-environment jsdom
/**
 * JoinConfirmDialog (VRX-210) — the confirmation gate over the shared join
 * flow. Covers: interception of the row-pill and drawer-button join paths,
 * confirm/cancel/Esc/outside semantics, the openness honesty copy, the CVR
 * mode picker vs the VRChat honest note, the never-show-again footnote, the
 * who's-there row (exact worldId+instanceId filter, ≤4 avatars + "+N"), and
 * the one-shot CVR people count. Path-integration tests render the REAL
 * FriendsList next to the dialog (like AppShell does); copy/variant tests
 * drive the gate through a tiny OpenJoin harness.
 */
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Friend, InstanceInfo } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import '../i18n'
import { useFriendsStore } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'
import { useJoinInstance } from '../hooks/useJoinInstance'
import FriendsList from './FriendsList'
import JoinConfirmDialog from './JoinConfirmDialog'

const useFriendsMock = vi.hoisted(() => vi.fn())
vi.mock('../queries/friends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/friends')>()),
  useFriends: useFriendsMock
}))
vi.mock('../queries/auth', () => ({
  useAuthStatus: (platform: 'vrchat' | 'chilloutvr') => ({
    data: {
      platform,
      state: 'authenticated',
      accountId: `${platform}-test`,
      displayName: 'Test User'
    }
  })
}))

// jsdom has no ResizeObserver; the mode picker's bubble hook needs one.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
)

const publicInstance: InstanceInfo = {
  worldId: 'wrld_fixture',
  instanceId: 'wrld_fixture:12345~public',
  worldName: 'The Great Pug',
  thumbnailUrl: null,
  type: 'public',
  openness: 'public',
  isGroup: false,
  groupName: null,
  region: 'us',
  userCount: 14
}

const joinableFriend: Friend = {
  platformUserId: 'usr_alex',
  platform: 'vrchat',
  displayName: 'Alex',
  avatarUrl: null,
  presence: { state: 'in-game' },
  status: 'online',
  statusDescription: null,
  instance: publicInstance,
  trustRank: null,
  isFavorite: false,
  favoriteGroupIds: [],
  linkedPersonId: null
}

const cvrInstance: InstanceInfo = {
  ...publicInstance,
  worldId: 'cvr_world',
  instanceId: 'cvr_world:abc',
  worldName: 'CVR Hub',
  type: 'friends-of-friends',
  openness: 'friends-plus',
  region: null
}

const cvrFriend: Friend = {
  platformUserId: 'cvr_mika',
  platform: 'chilloutvr',
  displayName: 'Mika',
  avatarUrl: null,
  presence: { state: 'in-game' },
  status: null,
  statusDescription: null,
  instance: cvrInstance,
  trustRank: null,
  isFavorite: false,
  favoriteGroupIds: [],
  linkedPersonId: null
}

function mockFriends(vrc: Friend[], cvr: Friend[] = []): void {
  useFriendsMock.mockImplementation((platform: string) => ({
    data: platform === 'vrchat' ? vrc : cvr,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn()
  }))
}

/** Drives the confirmation gate without a list surface (copy/variant tests). */
function OpenJoin({ friend }: { friend: Friend }): React.JSX.Element {
  const { join } = useJoinInstance()
  return (
    <button type="button" onClick={() => void join(friend)}>
      open join
    </button>
  )
}

const confirmDialog = (): HTMLElement =>
  screen.getByRole('dialog', { name: /Join this .* instance\?/ })

let joinInstance: ReturnType<typeof vi.fn>
let getFriendNote: ReturnType<typeof vi.fn>
let setFriendNote: ReturnType<typeof vi.fn>

beforeEach(() => {
  joinInstance = vi.fn().mockResolvedValue({ ok: true })
  getFriendNote = vi
    .fn()
    .mockResolvedValue({ note: null, revision: { platformAccountId: 'self', epoch: 1 } })
  setFriendNote = vi.fn().mockResolvedValue({ ok: true })
  window.vrx = { joinInstance, getFriendNote, setFriendNote } as unknown as Window['vrx']
  useFriendsStore.setState({ search: '', platformFilter: 'all', selectedFriendId: null })
  // confirmJoin defaults TRUE (the cautious default this feature ships with).
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false })
  mockFriends([joinableFriend])
})

afterEach(() => {
  // The join store is module-level: close any parked confirmation so an open
  // dialog never leaks into the next test.
  const { result } = renderHook(() => useJoinInstance())
  act(() => result.current.cancelPending())
  cleanup()
  vi.useRealTimers()
  useFriendsMock.mockReset()
})

describe('join path interception (confirmJoin on)', () => {
  it('row pill: opens the dialog; Confirm fires joinInstance EXACTLY once and closes', async () => {
    render(
      <>
        <FriendsList />
        <JoinConfirmDialog />
      </>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Join Alex in The Great Pug' }))
    const dialog = confirmDialog()
    expect(joinInstance).not.toHaveBeenCalled()
    // Focus lands on Cancel — the SAFE default; Confirm is never auto-focused.
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }))

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Join' }))
      await Promise.resolve()
    })

    expect(joinInstance).toHaveBeenCalledOnce()
    expect(joinInstance).toHaveBeenCalledWith({
      platform: 'vrchat',
      friendId: 'usr_alex',
      mode: 'desktop'
    })
    expect(screen.queryByRole('dialog', { name: /Join this .* instance\?/ })).toBeNull()
  })

  it('drawer Join button: same dialog, same single join', async () => {
    useFriendsStore.setState({ selectedFriendId: 'vrchat:usr_alex' })
    render(
      <>
        <FriendsList />
        <JoinConfirmDialog />
      </>
    )

    // The drawer's own Join button (the drawer is also a role=dialog).
    const drawer = screen.getByRole('dialog', { name: 'Alex' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Join' }))
    expect(joinInstance).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Join' }))
      await Promise.resolve()
    })

    expect(joinInstance).toHaveBeenCalledOnce()
    expect(joinInstance).toHaveBeenCalledWith({
      platform: 'vrchat',
      friendId: 'usr_alex',
      mode: 'desktop'
    })
  })

  it('Cancel fires nothing and closes', () => {
    render(
      <>
        <OpenJoin friend={joinableFriend} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))
    fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Cancel' }))

    expect(joinInstance).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: /Join this .* instance\?/ })).toBeNull()
  })

  it('Esc fires nothing and closes', () => {
    render(
      <>
        <OpenJoin friend={joinableFriend} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))
    expect(confirmDialog()).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(joinInstance).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: /Join this .* instance\?/ })).toBeNull()
  })

  it('outside pointerdown (the scrim) fires nothing and closes', () => {
    render(
      <>
        <OpenJoin friend={joinableFriend} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))
    fireEvent.pointerDown(screen.getByTestId('join-confirm-scrim'))

    expect(joinInstance).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: /Join this .* instance\?/ })).toBeNull()
  })
})

describe('confirmJoin off (one-click behavior preserved)', () => {
  it('joinInstance fires immediately and the dialog never renders', async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, confirmJoin: false },
      dirty: false
    })
    render(
      <>
        <FriendsList />
        <JoinConfirmDialog />
      </>
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Join Alex in The Great Pug' }))
      await Promise.resolve()
    })

    expect(screen.queryByRole('dialog', { name: /Join this .* instance\?/ })).toBeNull()
    expect(joinInstance).toHaveBeenCalledOnce()
    expect(joinInstance).toHaveBeenCalledWith({
      platform: 'vrchat',
      friendId: 'usr_alex',
      mode: 'desktop'
    })
  })
})

describe('openness copy (the safety context)', () => {
  it.each([
    ['public', 'public'],
    ['friends-plus', 'friends-plus']
  ] as const)('%s → effectively-public wording', (type, openness) => {
    const friend: Friend = {
      ...joinableFriend,
      instance: { ...publicInstance, type, openness }
    }
    render(
      <>
        <OpenJoin friend={friend} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))

    expect(
      within(confirmDialog()).getByText("Effectively public — people you don't know can get in.")
    ).toBeTruthy()
  })

  it.each([
    ['friends', 'friends'],
    ['invite-plus', 'invite-plus'],
    ['invite', 'invite']
  ] as const)('%s → effectively-private wording', (type, openness) => {
    const friend: Friend = {
      ...joinableFriend,
      instance: { ...publicInstance, type, openness }
    }
    render(
      <>
        <OpenJoin friend={friend} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))

    expect(
      within(confirmDialog()).getByText('Effectively private — gated by friendship or invites.')
    ).toBeTruthy()
  })

  it('missing instance data → "Openness unknown" + generic title (never a privacy claim)', () => {
    const friend: Friend = { ...joinableFriend, instance: null }
    render(
      <>
        <OpenJoin friend={friend} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))

    const dialog = screen.getByRole('dialog', { name: 'Join this instance?' })
    expect(within(dialog).getByText('Openness unknown')).toBeTruthy()
    expect(within(dialog).queryByText(/Effectively/)).toBeNull()
  })

  it('More info discloses the explainer inline (no new modal)', () => {
    render(
      <>
        <OpenJoin friend={joinableFriend} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))
    const dialog = confirmDialog()
    const toggle = within(dialog).getByRole('button', { name: 'More info' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(
      within(dialog).getByText(
        'Anyone can walk into a public instance — treat it as a fully open space.'
      )
    ).toBeTruthy()
  })
})

describe('mode picker — CVR only (research-settled)', () => {
  it('chilloutvr + joinMode ask → picker renders; the choice passes as mode', async () => {
    mockFriends([], [cvrFriend])
    render(
      <>
        <OpenJoin friend={cvrFriend} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))
    const dialog = screen.getByRole('dialog', { name: 'Join this Friends+ instance?' })

    const group = within(dialog).getByRole('radiogroup', { name: 'Launch mode' })
    fireEvent.click(within(group).getByRole('radio', { name: 'VR' }))
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Join' }))
      await Promise.resolve()
    })

    expect(joinInstance).toHaveBeenCalledOnce()
    expect(joinInstance).toHaveBeenCalledWith({
      platform: 'chilloutvr',
      friendId: 'cvr_mika',
      mode: 'vr'
    })
  })

  it('joinMode vr → no picker; the setting passes through', async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, joinMode: 'vr' },
      dirty: false
    })
    mockFriends([], [cvrFriend])
    render(
      <>
        <OpenJoin friend={cvrFriend} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))
    const dialog = screen.getByRole('dialog', { name: 'Join this Friends+ instance?' })
    expect(within(dialog).queryByRole('radiogroup')).toBeNull()

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Join' }))
      await Promise.resolve()
    })

    expect(joinInstance).toHaveBeenCalledWith({
      platform: 'chilloutvr',
      friendId: 'cvr_mika',
      mode: 'vr'
    })
  })

  it('VRChat → the honest note and NO picker (vrchat:// cannot select mode)', () => {
    render(
      <>
        <OpenJoin friend={joinableFriend} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))
    const dialog = confirmDialog()

    expect(within(dialog).queryByRole('radiogroup')).toBeNull()
    expect(
      within(dialog).getByText('VRChat chooses VR or desktop from its own launch settings.')
    ).toBeTruthy()
  })
})

describe("who's-there row", () => {
  it('filters by exact worldId + instanceId; ≤4 avatars + "+N" overflow', () => {
    const sameInstance = Array.from({ length: 5 }, (_, i) => ({
      ...joinableFriend,
      platformUserId: `usr_${i}`,
      displayName: `F${i}`
    }))
    const elsewhere: Friend = {
      ...joinableFriend,
      platformUserId: 'usr_else',
      displayName: 'Elsewhere',
      instance: { ...publicInstance, instanceId: 'wrld_fixture:999~public' }
    }
    mockFriends([...sameInstance, elsewhere])
    render(
      <>
        <OpenJoin friend={sameInstance[0]!} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))
    const dialog = confirmDialog()

    expect(within(dialog).getAllByRole('img')).toHaveLength(4)
    expect(within(dialog).getByText('+1')).toBeTruthy() // 5 same-instance, NOT +2
  })

  it('CVR: one getInstanceDetails call on open; "· N people" when it resolves', async () => {
    const getInstanceDetails = vi.fn().mockResolvedValue({ ...cvrInstance, userCount: 7 })
    window.vrx = {
      joinInstance,
      getFriendNote,
      setFriendNote,
      getInstanceDetails
    } as unknown as Window['vrx']
    mockFriends([], [cvrFriend])
    render(
      <>
        <OpenJoin friend={cvrFriend} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))

    expect(getInstanceDetails).toHaveBeenCalledOnce()
    expect(getInstanceDetails).toHaveBeenCalledWith('cvr_world:abc')
    expect(await within(confirmDialog()).findByText('· 7 people')).toBeTruthy()
  })

  it('CVR: a failed details fetch silently omits the total (no error UI, no retry)', async () => {
    const getInstanceDetails = vi.fn().mockRejectedValue(new Error('private'))
    window.vrx = {
      joinInstance,
      getFriendNote,
      setFriendNote,
      getInstanceDetails
    } as unknown as Window['vrx']
    mockFriends([], [cvrFriend])
    render(
      <>
        <OpenJoin friend={cvrFriend} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))
    await act(async () => {
      await Promise.resolve()
    })

    expect(getInstanceDetails).toHaveBeenCalledOnce()
    const dialog = screen.getByRole('dialog', { name: 'Join this Friends+ instance?' })
    expect(within(dialog).queryByText(/· \d+ people/)).toBeNull()
    // The friends row is the substance — still there.
    expect(within(dialog).getAllByRole('img')).toHaveLength(1)
  })

  it('VRChat: getInstanceDetails is NEVER called (stub + unverified upstream)', () => {
    const getInstanceDetails = vi.fn()
    window.vrx = {
      joinInstance,
      getFriendNote,
      setFriendNote,
      getInstanceDetails
    } as unknown as Window['vrx']
    render(
      <>
        <OpenJoin friend={joinableFriend} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))

    expect(confirmDialog()).toBeTruthy()
    expect(getInstanceDetails).not.toHaveBeenCalled()
  })
})

describe('never-show-again footnote', () => {
  it('saves confirmJoin=false AND proceeds with the join, exactly once', async () => {
    render(
      <>
        <OpenJoin friend={joinableFriend} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))

    await act(async () => {
      fireEvent.click(
        within(confirmDialog()).getByRole('button', {
          name: "Don't ask again (Settings › re-enable anytime)"
        })
      )
      await Promise.resolve()
    })

    expect(useSettingsStore.getState().settings.confirmJoin).toBe(false)
    expect(joinInstance).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog', { name: /Join this .* instance\?/ })).toBeNull()
  })
})
