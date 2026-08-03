// @vitest-environment jsdom
/**
 * JoinConfirmDialog (VRX-210) — the confirmation gate over the shared join
 * flow. Covers: interception of the row-pill and drawer-button join paths,
 * confirm/cancel/Esc/outside semantics, the openness honesty copy, the CVR
 * mode picker vs the VRChat honest note, the never-show-again footnote, the
 * who's-there row (shared hot-instance key + platform + visibility filter, ≤4 avatars + "+N"), and
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
import { useSettingsPersistence } from '../hooks/useSettingsPersistence'
import { queryClient } from '../queries/queryClient'
import { friendsQueryKey } from '../queries/friends'
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
  // The dialog reads the TanStack cache synchronously for its live-friend
  // lookup and Confirm preflight, so the mock must also seed the real cache.
  queryClient.setQueryData(friendsQueryKey('vrchat'), vrc)
  queryClient.setQueryData(friendsQueryKey('chilloutvr'), cvr)
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

/** Mounts the REAL save path (dirty → save-settings IPC) for persistence pins. */
function WithPersistence(): null {
  useSettingsPersistence()
  return null
}

// Matches both the typed headline ("Join this Friends+ instance?") and the
// neutral unknown-openness headline ("Join this instance?" — no type segment).
const confirmDialog = (): HTMLElement =>
  screen.getByRole('dialog', { name: /Join this .*instance\?/ })

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
    // Deferred bridge: the double-activation below must STILL produce one call.
    let resolveJoin!: (result: { ok: true }) => void
    joinInstance.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveJoin = resolve
        })
    )
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
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    expect(document.activeElement).toBe(cancel)

    const confirm = within(dialog).getByRole('button', { name: 'Join' })
    fireEvent.click(confirm)
    // Double-activation: the first click synchronously clears pendingConfirm
    // and latches the join — this second handler run MUST be a no-op.
    fireEvent.click(confirm)
    await act(async () => {
      resolveJoin({ ok: true })
      await Promise.resolve()
    })

    expect(joinInstance).toHaveBeenCalledOnce()
    expect(joinInstance).toHaveBeenCalledWith({
      platform: 'vrchat',
      friendId: 'usr_alex',
      mode: 'desktop',
      expectedTarget: {
        worldId: publicInstance.worldId,
        instanceId: publicInstance.instanceId
      }
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
      mode: 'desktop',
      expectedTarget: {
        worldId: publicInstance.worldId,
        instanceId: publicInstance.instanceId
      }
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
      mode: 'desktop',
      expectedTarget: {
        worldId: publicInstance.worldId,
        instanceId: publicInstance.instanceId
      }
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
      within(confirmDialog()).getByText('This instance is considered an open instance.')
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
    mockFriends([friend])
    render(
      <>
        <OpenJoin friend={friend} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))

    expect(
      within(confirmDialog()).getByText('This instance is considered a closed instance.')
    ).toBeTruthy()
  })

  it('unknown CVR openness uses the safe unknown copy instead of the degraded Invite copy', () => {
    const unknown: Friend = {
      ...cvrFriend,
      instance: {
        ...cvrInstance,
        type: 'owner-must-invite',
        openness: 'invite',
        opennessUnknown: true
      }
    }
    render(
      <>
        <OpenJoin friend={unknown} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))

    const dialog = confirmDialog()
    // The headline stays NEUTRAL: a degraded privacy flag must not title the
    // dialog with the type it degraded to ("Invite") above an "unknown" body.
    expect(within(dialog).getByRole('heading', { name: 'Join this instance?' })).toBeTruthy()
    expect(
      within(dialog).getByText("We couldn't confirm whether this instance is open or closed.")
    ).toBeTruthy()
    expect(within(dialog).queryByText(/considered a closed/)).toBeNull()
  })

  it('More info on unknown openness discloses the safe unknown explainer', () => {
    const unknown: Friend = {
      ...cvrFriend,
      instance: {
        ...cvrInstance,
        type: 'owner-must-invite',
        openness: 'invite',
        opennessUnknown: true
      }
    }
    render(
      <>
        <OpenJoin friend={unknown} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))
    const dialog = confirmDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'More info' }))

    expect(
      within(dialog).getByText(
        "VRX couldn't read this instance's privacy, so it can't say how open it is. Treat it as open."
      )
    ).toBeTruthy()
  })

  it('missing instance data keeps the gate closed (non-joinable friend cannot confirm)', () => {
    const friend: Friend = { ...joinableFriend, instance: null }
    mockFriends([friend])
    render(
      <>
        <OpenJoin friend={friend} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))

    expect(screen.queryByRole('dialog', { name: 'Join this instance?' })).toBeNull()
    expect(joinInstance).not.toHaveBeenCalled()
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

describe('instance-type pill (VRX-245)', () => {
  it('renders the type label under the platform pill for a known instance', () => {
    render(
      <>
        <OpenJoin friend={joinableFriend} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))
    const dialog = confirmDialog()

    // The title already asserts "Join this Public instance?" — the pill is a
    // second, non-heading element carrying the same label.
    expect(within(dialog).getByRole('heading', { name: 'Join this Public instance?' })).toBeTruthy()
    const pills = within(dialog)
      .getAllByText('Public')
      .filter((el) => el.tagName === 'SPAN')
    expect(pills).toHaveLength(1)
  })

  it('does NOT render the type pill when openness is unknown', () => {
    const unknown: Friend = {
      ...cvrFriend,
      instance: {
        ...cvrInstance,
        type: 'owner-must-invite',
        openness: 'invite',
        opennessUnknown: true
      }
    }
    render(
      <>
        <OpenJoin friend={unknown} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))
    const dialog = screen.getByRole('dialog', { name: 'Join this instance?' })

    expect(within(dialog).queryByText('Invite')).toBeNull()
  })
})

describe('openness line is visually quiet (VRX-245)', () => {
  it('uses --text-dim and has no inline color style', () => {
    render(
      <>
        <OpenJoin friend={joinableFriend} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))
    const dialog = confirmDialog()
    const line = within(dialog).getByText('This instance is considered an open instance.')

    expect(line.className).toContain('text-[var(--text-dim)]')
    expect(line.hasAttribute('style')).toBe(false)
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
      mode: 'vr',
      expectedTarget: {
        worldId: cvrInstance.worldId,
        instanceId: cvrInstance.instanceId
      }
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
      mode: 'vr',
      expectedTarget: {
        worldId: cvrInstance.worldId,
        instanceId: cvrInstance.instanceId
      }
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

  it('CVR mid-enrichment: an enriched roster member (real world.id) still matches the parked unresolved instance (VRX-237)', () => {
    // The parked friend's instance still carries CVR's unresolved fallback
    // (worldId === instanceId) while a roster member's copy already enriched
    // to the real world.id. A raw worldId+instanceId match would DROP the
    // member; the shared hotInstanceKey (CVR = instance id alone) keeps them.
    const unresolved: InstanceInfo = {
      ...cvrInstance,
      worldId: 'i+unresolved1',
      instanceId: 'i+unresolved1',
      worldName: 'Creator Instance Copy'
    }
    const parked: Friend = { ...cvrFriend, platformUserId: 'cvr_parked', instance: unresolved }
    const enrichedMember: Friend = {
      ...cvrFriend,
      platformUserId: 'cvr_member',
      displayName: 'Enriched',
      instance: { ...unresolved, worldId: 'world-real-9', worldName: 'Authoritative World' }
    }
    mockFriends([], [parked, enrichedMember])
    render(
      <>
        <OpenJoin friend={parked} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))
    const dialog = confirmDialog()

    // BOTH the parked friend and the enriched member are shown — the cohort
    // the hot card truthfully groups is the cohort the dialog lists.
    expect(within(dialog).getAllByRole('img')).toHaveLength(2)
  })

  it('never matches across platforms on colliding worldId + instanceId strings (VRX-237)', () => {
    // Same raw worldId/instanceId text on BOTH platforms: the platform gate +
    // platform-aware key must keep the CVR friend out of a VRChat dialog.
    const colliding: InstanceInfo = {
      ...publicInstance,
      worldId: 'wrld_same',
      instanceId: 'wrld_same:1~public'
    }
    const parked: Friend = { ...joinableFriend, instance: colliding }
    const cvrColliding: Friend = {
      ...cvrFriend,
      platformUserId: 'cvr_collision',
      displayName: 'CrossPlatform',
      instance: { ...colliding }
    }
    mockFriends([parked], [cvrColliding])
    render(
      <>
        <OpenJoin friend={parked} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))
    const dialog = confirmDialog()

    // Only the parked VRChat friend is present — the CVR lookalike is not.
    expect(within(dialog).getAllByRole('img')).toHaveLength(1)
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
  it('saves confirmJoin=false through the REAL save path AND proceeds with the join, exactly once', async () => {
    const getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS)
    const saveSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS)
    window.vrx = {
      joinInstance,
      getFriendNote,
      setFriendNote,
      getSettings,
      saveSettings
    } as unknown as Window['vrx']
    render(
      <>
        <WithPersistence />
        <OpenJoin friend={joinableFriend} />
        <JoinConfirmDialog />
      </>
    )
    // Let the boot load land — saves are gated until it does (VRX-184).
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
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
    // The persistence PIN: the choice reaches disk, not just the store.
    expect(saveSettings).toHaveBeenCalledWith({
      patch: expect.objectContaining({ confirmJoin: false })
    })
  })
})

describe('drawer coexistence (the drawer must SURVIVE the modal)', () => {
  function renderDrawerPlusDialog(): void {
    useFriendsStore.setState({ selectedFriendId: 'vrchat:usr_alex' })
    render(
      <>
        <FriendsList />
        <JoinConfirmDialog />
      </>
    )
  }

  it('a real pointerdown INSIDE the dialog does NOT close the drawer', () => {
    renderDrawerPlusDialog()
    const drawer = screen.getByRole('dialog', { name: 'Alex' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Join' }))
    const dialog = confirmDialog()

    // fireEvent.click never dispatches pointerdown — the regression hid behind
    // that. Drive the real sequence: pointerdown THEN click on Cancel.
    fireEvent.pointerDown(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('dialog', { name: 'Alex' })).toBeTruthy()

    // More info + a radio press are pointerdowns too — the drawer stays.
    fireEvent.pointerDown(within(dialog).getByRole('button', { name: 'More info' }))
    expect(screen.getByRole('dialog', { name: 'Alex' })).toBeTruthy()
  })

  it('Esc closes ONLY the dialog; the drawer stays open', () => {
    renderDrawerPlusDialog()
    const drawer = screen.getByRole('dialog', { name: 'Alex' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Join' }))
    expect(confirmDialog()).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: /Join this .* instance\?/ })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Alex' })).toBeTruthy()
    expect(joinInstance).not.toHaveBeenCalled()
  })

  it("Cancel from a DRAWER-originated join returns focus to the drawer's Join button (not ✕)", () => {
    renderDrawerPlusDialog()
    const drawer = screen.getByRole('dialog', { name: 'Alex' })
    const drawerJoin = within(drawer).getByRole('button', { name: 'Join' })
    drawerJoin.focus()
    fireEvent.click(drawerJoin)
    const dialog = confirmDialog()
    expect(document.activeElement).not.toBe(drawerJoin) // moved into the modal

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    // The drawer's initial-focus effect is keyed on `open` ONLY — the dialog
    // opening/closing must not re-focus ✕ over the dialog's own restoration.
    expect(document.activeElement).toBe(drawerJoin)
  })
})

describe('modal behavior', () => {
  it('wears the HEAVY frost + clips the stripe into the radius (VRX-245)', () => {
    render(
      <>
        <OpenJoin friend={joinableFriend} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))
    const classes = confirmDialog().className.split(/\s+/)
    expect(classes).toContain('glass')
    expect(classes).toContain('glass-frosted-heavy')
    // the drawer keeps the LIGHTER frost — the modal must not fall back to it
    expect(classes).not.toContain('glass-frosted')
    // the stripe drops its hardcoded radius and relies on the panel clipping it
    expect(classes).toContain('overflow-hidden')

    // the aria-hidden platform stripe must rely on the panel's overflow-hidden
    // clip instead of carrying its own hardcoded corner radius.
    const stripe = confirmDialog().querySelector('span[aria-hidden]')
    expect(stripe?.className).not.toContain('rounded-t-[20px]')
  })

  it('Tab with focus OUTSIDE the panel re-enters the trap', () => {
    render(
      <>
        <OpenJoin friend={joinableFriend} />
        <JoinConfirmDialog />
      </>
    )
    const opener = screen.getByRole('button', { name: 'open join' })
    fireEvent.click(opener)
    const dialog = confirmDialog()
    // Simulate focus escaping the panel (e.g. a devtools click, a late blur).
    opener.focus()
    expect(document.activeElement).toBe(opener)

    fireEvent.keyDown(document, { key: 'Tab' })

    expect(document.activeElement).not.toBe(opener)
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it("the global '/' search shortcut is suppressed while the dialog is open", () => {
    render(
      <>
        <FriendsList />
        <JoinConfirmDialog />
      </>
    )
    const search = screen.getByPlaceholderText('Search friends')
    fireEvent.click(screen.getByRole('button', { name: 'Join Alex in The Great Pug' }))
    expect(confirmDialog()).toBeTruthy()

    fireEvent.keyDown(document, { key: '/' })
    expect(document.activeElement).not.toBe(search)

    // …and restored once the dialog is gone (the list is live again).
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.keyDown(document, { key: '/' })
    expect(document.activeElement).toBe(search)
  })

  it('a second join() for a DIFFERENT friend does NOT swap the parked dialog', async () => {
    const bea: Friend = { ...joinableFriend, platformUserId: 'usr_bea', displayName: 'Bea' }
    render(
      <>
        <OpenJoin friend={joinableFriend} />
        <OpenJoin friend={bea} />
        <JoinConfirmDialog />
      </>
    )
    const buttons = screen.getAllByRole('button', { name: 'open join' })
    fireEvent.click(buttons[0]!) // Alex's dialog parks
    expect(confirmDialog()).toBeTruthy()

    fireEvent.click(buttons[1]!) // Bea — must be ignored, not a silent swap
    expect(screen.getByRole('dialog', { name: 'Join this Public instance?' })).toBeTruthy()
    expect(within(confirmDialog()).getByText(/Alex is in/)).toBeTruthy()

    await act(async () => {
      fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Join' }))
      await Promise.resolve()
    })
    expect(joinInstance).toHaveBeenCalledOnce()
    expect(joinInstance).toHaveBeenCalledWith(
      expect.objectContaining({ friendId: 'usr_alex' }) // Alex, not Bea
    )
  })
})

describe('group instances get group-accurate copy', () => {
  const groupBase: InstanceInfo = {
    ...publicInstance,
    isGroup: true,
    groupName: 'Night Owls'
  }

  it.each([
    ['group-public', 'public', 'group-public', 'This instance is considered an open instance.'],
    [
      'group-plus (VRChat: friends of whoever is INSIDE)',
      'friends-plus',
      'group-plus',
      'This instance is considered an open instance.'
    ],
    ['members-only group', 'invite', 'group', 'This instance is considered a closed instance.']
  ] as const)('%s → openness line maps to open/closed', (_case, openness, type, headline) => {
    const friend: Friend = {
      ...joinableFriend,
      instance: { ...groupBase, openness, type }
    }
    mockFriends([friend])
    render(
      <>
        <OpenJoin friend={friend} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))

    expect(within(confirmDialog()).getByText(headline)).toBeTruthy()
  })

  it("CVR friends-of-members keeps the friends-of-group-MEMBERS rule (that IS CVR's rule)", () => {
    const cvrGroupFriend: Friend = {
      ...cvrFriend,
      instance: {
        ...cvrInstance,
        type: 'friends-of-members',
        openness: 'friends-plus',
        isGroup: true,
        groupName: 'Night Owls'
      }
    }
    mockFriends([], [cvrGroupFriend])
    render(
      <>
        <OpenJoin friend={cvrGroupFriend} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))
    const dialog = confirmDialog()

    expect(within(dialog).getByText('This instance is considered an open instance.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'More info' }))
    expect(
      within(dialog).getByText(
        /friends of its members can join, so the crowd can be wider than your own friend list. Treat it as open./
      )
    ).toBeTruthy()
  })

  it('members-only more-info: friendship and invites do NOT apply', () => {
    const friend: Friend = {
      ...joinableFriend,
      instance: { ...groupBase, openness: 'invite', type: 'group' }
    }
    mockFriends([friend])
    render(
      <>
        <OpenJoin friend={friend} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))
    fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'More info' }))

    expect(
      within(confirmDialog()).getByText(
        /Only Night Owls members can get in — friendship and invites don't apply/
      )
    ).toBeTruthy()
  })

  it('a null groupName degrades to "the group" (never a blank hole)', () => {
    const friend: Friend = {
      ...joinableFriend,
      instance: { ...groupBase, groupName: null, openness: 'invite', type: 'group' }
    }
    mockFriends([friend])
    render(
      <>
        <OpenJoin friend={friend} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))

    expect(
      within(confirmDialog()).getByText('This instance is considered a closed instance.')
    ).toBeTruthy()
  })
})

describe('footnote persists a PICKED mode (CVR picker only)', () => {
  const cvrSecond: Friend = { ...cvrFriend, platformUserId: 'cvr_ren', displayName: 'Ren' }

  it('pick VR → footnote writes confirmJoin=false AND joinMode=vr; the NEXT join carries vr', async () => {
    mockFriends([], [cvrFriend, cvrSecond])
    render(
      <>
        <OpenJoin friend={cvrFriend} />
        <OpenJoin friend={cvrSecond} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'open join' })[0]!)
    const dialog = screen.getByRole('dialog', { name: 'Join this Friends+ instance?' })
    fireEvent.click(
      within(within(dialog).getByRole('radiogroup', { name: 'Launch mode' })).getByRole('radio', {
        name: 'VR'
      })
    )

    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole('button', {
          name: "Don't ask again (Settings › re-enable anytime)"
        })
      )
      await Promise.resolve()
    })

    expect(useSettingsStore.getState().settings.confirmJoin).toBe(false)
    expect(useSettingsStore.getState().settings.joinMode).toBe('vr')
    expect(joinInstance).toHaveBeenCalledWith(
      expect.objectContaining({ friendId: 'cvr_mika', mode: 'vr' })
    )

    // The NEXT join (confirmJoin now off → immediate) honors the persisted pick.
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'open join' })[1]!)
      await Promise.resolve()
    })
    expect(joinInstance).toHaveBeenCalledTimes(2)
    expect(joinInstance).toHaveBeenLastCalledWith({
      platform: 'chilloutvr',
      friendId: 'cvr_ren',
      mode: 'vr',
      expectedTarget: {
        worldId: cvrInstance.worldId,
        instanceId: cvrInstance.instanceId
      }
    })
  })

  it('VRChat path: the footnote does NOT write the desktop placeholder over joinMode', async () => {
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
    expect(useSettingsStore.getState().settings.joinMode).toBe('ask') // untouched
  })
})

describe('focus management', () => {
  it('Cancel restores focus to the opening pill', () => {
    render(
      <>
        <FriendsList />
        <JoinConfirmDialog />
      </>
    )
    const pill = screen.getByRole('button', { name: 'Join Alex in The Great Pug' })
    pill.focus()
    fireEvent.click(pill)
    const dialog = confirmDialog()
    expect(document.activeElement).not.toBe(pill) // moved into the dialog

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(document.activeElement).toBe(pill)
  })

  it('Esc restores focus to the opening pill', () => {
    render(
      <>
        <FriendsList />
        <JoinConfirmDialog />
      </>
    )
    const pill = screen.getByRole('button', { name: 'Join Alex in The Great Pug' })
    pill.focus()
    fireEvent.click(pill)
    expect(confirmDialog()).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(document.activeElement).toBe(pill)
  })

  it('Confirm: the pill latches disabled, so focus lands on the main landmark (never <body>)', async () => {
    render(
      <>
        <main tabIndex={-1} data-testid="main-landmark">
          <FriendsList />
        </main>
        <JoinConfirmDialog />
      </>
    )
    const pill = screen.getByRole('button', { name: 'Join Alex in The Great Pug' })
    pill.focus()
    fireEvent.click(pill)

    await act(async () => {
      fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Join' }))
      await Promise.resolve()
    })

    expect(document.activeElement).toBe(screen.getByTestId('main-landmark'))
  })

  it('a DISCONNECTED opener is skipped too — focus lands on the main landmark', () => {
    render(
      <>
        <main tabIndex={-1} data-testid="main-landmark">
          <OpenJoin friend={joinableFriend} />
        </main>
        <JoinConfirmDialog />
      </>
    )
    const opener = screen.getByRole('button', { name: 'open join' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = confirmDialog()
    // The opener leaves the DOM while the dialog is open (e.g. the friend
    // went offline and the list re-rendered without the row).
    opener.remove()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(document.activeElement).toBe(screen.getByTestId('main-landmark'))
  })
})

describe("who's-there accessibility", () => {
  it('is a LIST whose avatars are named by PERSON, never by repeated status', () => {
    const sameInstance = Array.from({ length: 3 }, (_, i) => ({
      ...joinableFriend,
      platformUserId: `usr_${i}`,
      displayName: `F${i}`
    }))
    mockFriends(sameInstance)
    render(
      <>
        <OpenJoin friend={sameInstance[0]!} />
        <JoinConfirmDialog />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'open join' }))
    const dialog = confirmDialog()

    expect(within(dialog).getByRole('list')).toBeTruthy()
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(3)
    for (const name of ['F0', 'F1', 'F2']) {
      expect(within(dialog).getByRole('img', { name })).toBeTruthy()
    }
    // No avatar announces a bare status as its accessible name.
    expect(within(dialog).queryByRole('img', { name: 'Online' })).toBeNull()
  })
})

describe('CVR explicit mode preference (no picker) still says what Confirm does', () => {
  it.each([
    ['vr', 'Will launch in VR.'],
    ['desktop', 'Will launch on desktop.']
  ] as const)('joinMode %s → the quiet will-launch line', (joinMode, copy) => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, joinMode },
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
    expect(within(dialog).getByText(copy)).toBeTruthy()
  })
})

describe('people-count pluralization', () => {
  it('count:1 renders the SINGULAR ("· 1 person")', async () => {
    const getInstanceDetails = vi.fn().mockResolvedValue({ ...cvrInstance, userCount: 1 })
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

    expect(await within(confirmDialog()).findByText('· 1 person')).toBeTruthy()
  })
})
