import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Friend, InstanceInfo, PresenceState } from '@shared/types'
import '../i18n'

const { useFriends } = vi.hoisted(() => ({ useFriends: vi.fn() }))

// Mock only the hook; keep the real `combineFriendQueries` (pure) so its own
// suite below exercises the actual fold logic (VRX-66).
vi.mock('../queries/friends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/friends')>()),
  useFriends
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

// renderToStaticMarkup is SSR: zustand serves the store's INITIAL state to
// useSyncExternalStore's server snapshot, so setState never reaches the render.
// Mock the store with a mutable ref instead (verified empirically — VRX-183).
const scheme = vi.hoisted(() => ({ current: 'vrchat' }))
// Defaults to nothing collapsed so the pre-existing tests below (status rings,
// pills, ordering) see every fixture friend regardless of its section — the
// collapse behavior itself is exercised in the `presence sections` describe
// block below (and interactively in FriendsList.sections.test.tsx).
const collapsedFriendSections = vi.hoisted(() => ({ current: [] as string[] }))
vi.mock('../stores/settings', () => ({
  useSettingsStore: <T>(selector: (state: unknown) => T): T =>
    selector({
      settings: {
        labelScheme: scheme.current,
        collapsedFriendSections: collapsedFriendSections.current
      },
      updateSettings: () => {}
    })
}))

// Pin the platform filter so the render tests exercise ONE scoped query (the
// `useFriends` mock returns the same value for both platforms; the default 'all'
// would merge them and render every fixture twice). The merge/scope logic itself
// is unit-tested against `combineFriendQueries` below (VRX-66).
const platformFilter = vi.hoisted(() => ({ current: 'vrchat' }))
vi.mock('../stores/friends', () => ({
  useFriendsStore: <T>(selector: (state: unknown) => T): T =>
    selector({ platformFilter: platformFilter.current, search: '', setSearch: () => {} })
}))

import FriendsList from './FriendsList'
import { combineFriendQueries } from '../queries/friends'

const friend: Friend = {
  platformUserId: 'usr_fixture',
  platform: 'vrchat',
  displayName: 'VRChat Friend',
  avatarUrl: null,
  presence: { state: 'active' },
  status: 'join-me',
  statusDescription: 'Come hang out!',
  instance: null,
  trustRank: null,
  isFavorite: false,
  favoriteGroupIds: [],
  linkedPersonId: null
}

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

function mock(data: Friend[]): void {
  useFriends.mockReturnValue({
    data,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn()
  })
}

const render = (): string => renderToStaticMarkup(createElement(FriendsList))

describe('FriendsList', () => {
  beforeEach(() => mock([friend]))

  // ─── Avatar status ring (§9.1 — replaces the old dot + status pill) ──────────

  it.each([
    ['join-me', 'Join Me', 'joinme'],
    ['online', 'Online', 'online'],
    ['ask-me', 'Ask Me', 'askme'],
    ['dnd', 'Do Not Disturb', 'dnd']
  ] as const)(
    'renders %s as a status-color ring + aria-label, not a pill',
    (status, label, token) => {
      // In-game: status folds into the ring ONLY in a world — presence is
      // evaluated first since the VRX-69 review fix (a WS-offline friend
      // retains cached status; it must never paint the ring).
      mock([{ ...friend, status, presence: { state: 'in-game' } }])
      const markup = render()
      // Ring hue + badge dot both reference the status token.
      expect(markup).toContain(`var(--st-${token})`)
      // Status TEXT is exposed via the avatar aria-label (R10 — never color-only).
      expect(markup).toContain(`aria-label="${label}"`)
    }
  )

  it('an offline friend with a RETAINED status keeps the offline ring (presence first)', () => {
    // Pre-existing latent bug fixed in the VRX-69 review round: the WS
    // friend-offline path keeps the cached `status`, and the old status-first
    // fold painted an offline friend with a live status ring.
    mock([{ ...friend, status: 'ask-me', presence: { state: 'offline' } }])
    const markup = render()
    expect(markup).toContain('var(--offline)')
    expect(markup).not.toContain('var(--st-askme)')
    expect(markup).toContain('aria-label="Offline"')
  })

  it('carries a non-color platform signifier on the row (VRX-206 B&W test)', () => {
    // Reverses the old R10 carve-out (platform = spine color only): the platform
    // tab is aria-labelled with the full platform name AND shows the acronym as
    // text, so the platform survives with color removed (§5 black-and-white test).
    const markup = render()
    expect(markup).toContain('aria-label="VRChat"')
    expect((markup.match(/VRC</g) ?? []).length).toBe(1)
  })

  it('pins the platform-tab geometry contract (VRX-206 bake values)', () => {
    // The tab's layout is a coupled system (grid col + PHYSICAL negative margins +
    // writing mode); losing any class silently degrades it to an inline label.
    // -mt/-mb must stay physical: -my-* emits margin-block, which the tab's
    // vertical writing mode rotates onto the horizontal axis (review-caught High).
    const markup = render()
    expect(markup).toContain('grid-cols-[14px_42px_1fr_auto]')
    for (const cls of [
      '[writing-mode:vertical-rl]',
      'rotate-180',
      '-mt-[5px]',
      '-mb-[5px]',
      '-ml-[7px]',
      'w-[calc(100%+7px)]',
      'rounded-[9px]',
      'self-stretch'
    ]) {
      expect(markup).toContain(cls)
    }
    expect(markup).not.toContain('-my-[5px]')
  })

  // ─── Custom status — beside the name, exactly once (§9.1) ────────────────────

  it('renders the custom status beside the name exactly once', () => {
    mock([{ ...friend, statusDescription: 'Come hang out!', instance: publicInstance }])
    const markup = render()
    expect((markup.match(/Come hang out!/g) ?? []).length).toBe(1)
  })

  it('does not render a custom status for ChilloutVR friends', () => {
    mock([
      {
        ...friend,
        platform: 'chilloutvr',
        status: null,
        statusDescription: 'ignored',
        presence: { state: 'in-game' }
      } as unknown as Friend
    ])
    expect(render()).not.toContain('ignored')
  })

  // ─── World subline ──────────────────────────────────────────────────────────

  it('renders the world name in the subline for a visible instance', () => {
    mock([{ ...friend, instance: publicInstance }])
    expect(render()).toContain('The Great Pug')
  })

  it('renders the unknown-world fallback when worldName is null', () => {
    mock([{ ...friend, instance: { ...publicInstance, worldName: null } }])
    expect(render()).toContain('Unknown World')
  })

  it('renders no world when the instance is null', () => {
    const markup = render()
    expect(markup).not.toContain('The Great Pug')
    expect(markup).not.toContain('Unknown World')
  })

  // ─── Instance pill (§9.1 — openness label + future join target) ──────────────

  it.each([
    ['public', 'Public'],
    ['friends-plus', 'Friends+'],
    ['friends', 'Friends'],
    ['invite', 'Invite'],
    ['group', 'Group']
  ] as const)('renders the %s instance type as the pill label', (type, label) => {
    mock([{ ...friend, instance: { ...publicInstance, type } }])
    expect(render()).toContain(label)
  })

  it('shows "Private" (not the world or type) for an Ask Me friend in a hidden world', () => {
    mock([
      {
        ...friend,
        status: 'ask-me',
        statusDescription: 'taking commissions',
        instance: publicInstance,
        presence: { state: 'in-game' } // in a world, but the location is hidden
      }
    ])
    const markup = render()
    expect(markup).not.toContain('The Great Pug')
    // "Private" replaces BOTH the world AND the openness type label.
    expect(markup).not.toContain('Public')
    expect(markup).toContain('Private')
    // Custom status still shown (beside the name), exactly once.
    expect((markup.match(/taking commissions/g) ?? []).length).toBe(1)
  })

  it('shows "Private" for a DND friend in a hidden world', () => {
    mock([
      {
        ...friend,
        status: 'dnd',
        statusDescription: 'in meeting',
        instance: publicInstance,
        presence: { state: 'in-game' }
      }
    ])
    const markup = render()
    expect(markup).not.toContain('The Great Pug')
    expect(markup).not.toContain('Public')
    expect(markup).toContain('Private')
  })

  it('shows "Private" for an ONLINE-status friend in a hidden world (the screenshot bug)', () => {
    // VRChat reports location "private" for ANY friend in a private instance — not
    // just Ask Me/DND. instance parses to null but state says in-world → Private.
    mock([
      {
        ...friend,
        status: 'online',
        statusDescription: 'chilling',
        instance: null,
        presence: { state: 'in-game' }
      }
    ])
    const markup = render()
    expect(markup).toContain('Private')
  })

  it('shows "Private" for a join-me friend in a hidden world too', () => {
    mock([{ ...friend, status: 'join-me', instance: null, presence: { state: 'in-game' } }])
    expect(render()).toContain('Private')
  })

  it('shows NO pill for a web-active friend (online, truly not in a world)', () => {
    mock([{ ...friend, status: 'online', instance: null, presence: { state: 'active' } }])
    expect(render()).not.toContain('Private')
  })

  // ─── §6 openness-ladder pill colors ──────────────────────────────────────────

  it.each([
    ['public', 'op-public'],
    ['friends-plus', 'op-friends-plus'],
    ['friends', 'op-friends'],
    ['invite', 'op-invite'],
    ['group-public', 'op-group-public'],
    ['group', 'op-group']
  ] as const)('colors the %s pill with its ladder token', (type, token) => {
    mock([{ ...friend, instance: { ...publicInstance, type }, presence: { state: 'in-game' } }])
    expect(render()).toContain(`var(--${token}`)
  })

  it('colors CVR friends-of-friends with the shared friends-plus tier', () => {
    mock([
      {
        ...friend,
        platform: 'chilloutvr',
        status: null,
        statusDescription: null,
        presence: { state: 'in-game' },
        instance: { ...publicInstance, type: 'friends-of-friends' }
      } as Friend
    ])
    expect(render()).toContain('var(--op-friends-plus')
  })

  it('labels CVR types with the VRChat scheme (VRX-182 baseline)', () => {
    const cvr = (type: InstanceInfo['type']): Friend =>
      ({
        ...friend,
        platformUserId: `usr_${type}`,
        platform: 'chilloutvr',
        status: null,
        statusDescription: null,
        presence: { state: 'in-game' },
        instance: { ...publicInstance, type }
      }) as Friend
    mock([cvr('friends-of-friends'), cvr('members-only')])
    const markup = render()
    expect(markup).toContain('Friends+')
    expect(markup).not.toContain('Friends of Friends')
    expect(markup).toContain('>Group<')
    expect(markup).not.toContain('Members Only')
  })

  describe('labelScheme setting (VRX-183)', () => {
    afterEach(() => {
      scheme.current = 'vrchat'
    })

    const inWorld = (type: InstanceInfo['type'], platform: Friend['platform']): Friend =>
      ({
        ...friend,
        platformUserId: `usr_${type}`,
        platform,
        ...(platform === 'chilloutvr' ? { status: null, statusDescription: null } : {}),
        presence: { state: 'in-game' },
        instance: { ...publicInstance, type }
      }) as Friend

    it('chilloutvr scheme: a VRChat Group+ instance reads "Friends of Members"', () => {
      scheme.current = 'chilloutvr'
      mock([inWorld('group-plus', 'vrchat')])
      const markup = render()
      expect(markup).toContain('Friends of Members')
      expect(markup).not.toContain('Group+')
    })

    it('platform-native scheme: each platform keeps its own terms', () => {
      scheme.current = 'platform-native'
      mock([inWorld('members-only', 'chilloutvr'), inWorld('group', 'vrchat')])
      const markup = render()
      expect(markup).toContain('Members Only')
      expect(markup).toContain('>Group<')
    })
  })

  it('keeps the hidden "Private" pill neutral (no ladder token)', () => {
    mock([
      { ...friend, status: 'ask-me', instance: publicInstance, presence: { state: 'in-game' } }
    ])
    const markup = render()
    expect(markup).toContain('Private')
    expect(markup).not.toContain('var(--op-')
  })

  it('shows NO pill for an Ask Me friend in the menu (active, not in a world)', () => {
    // Location is hidden either way, but state distinguishes in-a-world from in-menu;
    // "Private" implies a hidden instance, so the menu case must show nothing (§9.1).
    mock([{ ...friend, status: 'ask-me', statusDescription: 'brb', presence: { state: 'active' } }])
    const markup = render()
    expect(markup).not.toContain('Private')
    expect(markup).not.toContain('Public')
  })

  it('renders no instance pill for an in-menu friend with no instance', () => {
    mock([{ ...friend, status: 'online', statusDescription: null, instance: null }])
    const markup = render()
    expect(markup).not.toContain('Private')
    expect(markup).not.toContain('Public')
  })

  // ─── Platform tab + CVR presence ring ────────────────────────────────────────

  it('renders the VRChat platform tab (--vrc tint + VRC acronym) for a VRChat friend', () => {
    const markup = render()
    expect(markup).toContain('var(--vrc)')
    expect(markup).toContain('var(--plat-vrc-ghost-text)')
    expect(markup).toContain('>VRC<')
  })

  it('renders the CVR platform tab + an in-game presence ring for a CVR friend', () => {
    mock([
      {
        ...friend,
        platform: 'chilloutvr',
        status: null,
        statusDescription: null,
        presence: { state: 'in-game' }
      } as Friend
    ])
    const markup = render()
    expect(markup).toContain('var(--cvr)')
    expect(markup).toContain('>CVR<')
    expect(markup).toContain('aria-label="ChilloutVR"')
    // VRX-207: CVR online = privacy tier 2 — the SAME ring as VRChat status:online,
    // never the state palette (the two-greens defect from the owner's smoke test).
    expect(markup).toContain('var(--st-online)')
    expect(markup).toContain('aria-label="Online"')
    expect(markup).not.toContain('var(--ingame)')
  })

  it('folds a statusless VRChat in-game friend onto the online ring too (platform parity)', () => {
    mock([{ ...friend, status: null, statusDescription: null, presence: { state: 'in-game' } }])
    const markup = render()
    expect(markup).toContain('var(--st-online)')
    expect(markup).toContain('aria-label="Online"')
    expect(markup).not.toContain('var(--ingame)')
  })

  // ─── Online-first ordering (VRX-67 slice) ────────────────────────────────────

  it('orders friends in-game → active → offline, alphabetical within each band', () => {
    const mk = (name: string, state: PresenceState): Friend => ({
      ...friend,
      platformUserId: `usr_${name}`,
      displayName: name,
      status: 'online',
      statusDescription: null,
      instance: null,
      presence: { state }
    })
    // Deliberately unsorted input across all three bands.
    mock([
      mk('Zed', 'offline'),
      mk('Yara', 'in-game'),
      mk('Xander', 'active'),
      mk('Anna', 'in-game')
    ])
    const markup = render()
    // Expected render order: Anna, Yara (in-game, alpha) → Xander (active) → Zed (offline).
    const positions = ['Anna', 'Yara', 'Xander', 'Zed'].map((n) => markup.indexOf(`>${n}<`))
    expect(positions.every((i) => i >= 0)).toBe(true) // all rendered
    expect([...positions].sort((a, b) => a - b)).toEqual(positions) // strictly in that order
  })

  // ─── Presence sections (VRX-67) ────────────────────────────────────────────

  describe('presence sections', () => {
    afterEach(() => {
      collapsedFriendSections.current = []
    })

    const mk = (name: string, state: PresenceState): Friend => ({
      ...friend,
      platformUserId: `usr_${name}`,
      displayName: name,
      status: 'online',
      statusDescription: null,
      instance: null,
      presence: { state }
    })

    it('renders the three section headers, in order, each with its live count', () => {
      mock([mk('Anna', 'in-game'), mk('Ben', 'in-game'), mk('Cara', 'active')])
      const markup = render()
      const inGamePos = markup.indexOf('In-Game (2)')
      const onlinePos = markup.indexOf('Online (1)')
      const offlinePos = markup.indexOf('Offline (0)')
      expect([inGamePos, onlinePos, offlinePos].every((i) => i >= 0)).toBe(true)
      expect(inGamePos).toBeLessThan(onlinePos)
      expect(onlinePos).toBeLessThan(offlinePos)
    })

    it('renders each section header as a button with aria-expanded reflecting its collapsed state', () => {
      collapsedFriendSections.current = ['offline']
      mock([mk('Anna', 'in-game'), mk('Zed', 'offline')])
      const markup = render()
      const buttons = [...markup.matchAll(/<button[\s\S]*?<\/button>/g)].map((m) => m[0])
      const inGameButton = buttons.find((b) => b.includes('In-Game'))
      const offlineButton = buttons.find((b) => b.includes('Offline'))
      expect(inGameButton).toContain('aria-expanded="true"')
      expect(offlineButton).toContain('aria-expanded="false"')
    })

    it('a collapsed section keeps its header (with count) but drops its rows from the list', () => {
      collapsedFriendSections.current = ['offline']
      mock([mk('Anna', 'in-game'), mk('Zed', 'offline')])
      const markup = render()
      expect(markup).toContain('Offline (1)') // header stays, count still live
      expect(markup).not.toContain('>Zed<') // row is gone
      expect(markup).toContain('>Anna<') // the expanded section's row still renders
    })
  })
})

// ─── combineFriendQueries — platform-filter fold (VRX-66) ─────────────────────

describe('combineFriendQueries', () => {
  const vrcFriend = { ...friend, platformUserId: 'usr_vrc', platform: 'vrchat' } as Friend
  const cvrFriend = { ...friend, platformUserId: 'usr_cvr', platform: 'chilloutvr' } as Friend

  type Q = Parameters<typeof combineFriendQueries>[1]
  const q = (over: Partial<Q> = {}): Q => ({
    data: undefined,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    ...over
  })

  it('vrchat filter passes only the VRChat query through', () => {
    const view = combineFriendQueries('vrchat', q({ data: [vrcFriend] }), q({ data: [cvrFriend] }))
    expect(view.friends).toEqual([vrcFriend])
  })

  it('chilloutvr filter passes only the ChilloutVR query through', () => {
    const view = combineFriendQueries(
      'chilloutvr',
      q({ data: [vrcFriend] }),
      q({ data: [cvrFriend] })
    )
    expect(view.friends).toEqual([cvrFriend])
  })

  it('all filter concatenates VRChat-then-ChilloutVR in order', () => {
    const view = combineFriendQueries('all', q({ data: [vrcFriend] }), q({ data: [cvrFriend] }))
    expect(view.friends).toEqual([vrcFriend, cvrFriend])
  })

  it('all filter with both empty yields an empty list (not undefined → shows empty state)', () => {
    const view = combineFriendQueries('all', q({ data: [] }), q({ data: [] }))
    expect(view.friends).toEqual([])
  })

  it('all filter shows loaded data even while the other platform is still pending', () => {
    const view = combineFriendQueries(
      'all',
      q({ data: [vrcFriend] }),
      q({ data: undefined, isPending: true })
    )
    expect(view.friends).toEqual([vrcFriend])
    expect(view.isPending).toBe(false)
  })

  it('all filter keeps loading while one query is pending even if the other errored', () => {
    // No data yet + one platform still loading → stay in the loading state (not a
    // blank frame) until the first data arrives (CodeRabbit VRX-66).
    const view = combineFriendQueries('all', q({ isError: true }), q({ isPending: true }))
    expect(view.friends).toBeUndefined()
    expect(view.isError).toBe(false) // not EVERY scoped query errored → no error yet
    expect(view.isPending).toBe(true)
  })

  it('all filter surfaces error only when every scoped query erred with no data', () => {
    const view = combineFriendQueries('all', q({ isError: true }), q({ isError: true }))
    expect(view.isError).toBe(true)
    expect(view.isPending).toBe(false) // both settled (errored) → not loading
    expect(view.friends).toBeUndefined()
  })

  it('all filter surfaces error (NOT empty) when one platform succeeds empty and the other errors', () => {
    // VRX-196: a failing platform must not hide behind the other's empty-but-
    // successful list — otherwise the user sees a false "no friends".
    const view = combineFriendQueries('all', q({ data: [] }), q({ isError: true }))
    expect(view.friends).toBeUndefined()
    expect(view.isError).toBe(true)
  })

  it('all filter keeps the empty state when both succeed empty (genuinely no friends, no error)', () => {
    const view = combineFriendQueries('all', q({ data: [] }), q({ data: [] }))
    expect(view.friends).toEqual([])
    expect(view.isError).toBe(false)
  })

  it('all filter keeps showing data on a partial failure (one has friends, other errors)', () => {
    const view = combineFriendQueries('all', q({ data: [vrcFriend] }), q({ isError: true }))
    expect(view.friends).toEqual([vrcFriend])
    expect(view.isError).toBe(false)
  })

  it('all filter keeps stale cached data AND flags isError on a background refetch failure (SWR)', () => {
    // The stale-while-revalidate contract FriendsList depends on: when both
    // platforms have cached data but a background refetch failed, keep showing
    // the data (friends defined) and surface the error separately — the render's
    // `isError && !friends` guard then suppresses the error text (CodeRabbit).
    const view = combineFriendQueries(
      'all',
      q({ data: [vrcFriend], isError: true }),
      q({ data: [cvrFriend], isError: true })
    )
    expect(view.friends).toEqual([vrcFriend, cvrFriend])
    expect(view.isError).toBe(true)
    expect(view.isPending).toBe(false)
  })

  it('isFetching is true if ANY scoped query is fetching; refetch fans out to all scoped', () => {
    const vrc = q({ data: [vrcFriend], isFetching: true })
    const cvr = q({ data: [cvrFriend] })
    const view = combineFriendQueries('all', vrc, cvr)
    expect(view.isFetching).toBe(true)
    view.refetch()
    expect(vrc.refetch).toHaveBeenCalledOnce()
    expect(cvr.refetch).toHaveBeenCalledOnce()
  })

  it('single-platform refetch does not touch the out-of-scope query', () => {
    const vrc = q({ data: [vrcFriend] })
    const cvr = q({ data: [cvrFriend] })
    combineFriendQueries('vrchat', vrc, cvr).refetch()
    expect(vrc.refetch).toHaveBeenCalledOnce()
    expect(cvr.refetch).not.toHaveBeenCalled()
  })
})
