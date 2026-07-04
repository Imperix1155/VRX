import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Friend, InstanceInfo } from '@shared/types'
import '../i18n'

const { useFriends } = vi.hoisted(() => ({ useFriends: vi.fn() }))

vi.mock('../queries/friends', () => ({ useFriends }))

// renderToStaticMarkup is SSR: zustand serves the store's INITIAL state to
// useSyncExternalStore's server snapshot, so setState never reaches the render.
// Mock the store with a mutable ref instead (verified empirically — VRX-183).
const scheme = vi.hoisted(() => ({ current: 'vrchat' }))
vi.mock('../stores/settings', () => ({
  useSettingsStore: <T>(selector: (state: unknown) => T): T =>
    selector({ settings: { labelScheme: scheme.current } })
}))

import FriendsList from './FriendsList'

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
      mock([{ ...friend, status }])
      const markup = render()
      // Ring hue + glyph badge both reference the status token.
      expect(markup).toContain(`var(--st-${token})`)
      // Status TEXT is exposed via the avatar aria-label (R10 — never color-only).
      expect(markup).toContain(`aria-label="${label}"`)
    }
  )

  it('drops the V/C platform glyph from the row (spine carries platform)', () => {
    // The old PlatformGlyph rendered an aria-labelled V/C square; the avatar now
    // carries a STATUS aria-label instead, and platform is the spine color only.
    const markup = render()
    expect(markup).not.toContain('aria-label="VRChat"')
    expect(markup).not.toContain('aria-label="ChilloutVR"')
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

  // ─── Platform spine + CVR presence ring ──────────────────────────────────────

  it('renders the VRChat spine (--vrc) for a VRChat friend', () => {
    expect(render()).toContain('var(--vrc)')
  })

  it('renders the CVR spine + an in-game presence ring for a CVR friend', () => {
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
    expect(markup).toContain('var(--ingame)')
    expect(markup).toContain('aria-label="In-game"')
  })
})
