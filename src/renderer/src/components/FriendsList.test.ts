import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Friend, InstanceInfo } from '@shared/types'
import '../i18n'

const { useFriends } = vi.hoisted(() => ({ useFriends: vi.fn() }))

vi.mock('../queries/friends', () => ({ useFriends }))

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

  it('shows "Private" (not the world or type) for an Ask Me friend whose instance is hidden', () => {
    mock([
      {
        ...friend,
        status: 'ask-me',
        statusDescription: 'taking commissions',
        instance: publicInstance
      }
    ])
    const markup = render()
    expect(markup).not.toContain('The Great Pug')
    expect(markup).toContain('Private')
    // Custom status still shown (beside the name), exactly once.
    expect((markup.match(/taking commissions/g) ?? []).length).toBe(1)
  })

  it('shows "Private" for a DND friend with a hidden instance', () => {
    mock([{ ...friend, status: 'dnd', statusDescription: 'in meeting', instance: publicInstance }])
    const markup = render()
    expect(markup).not.toContain('The Great Pug')
    expect(markup).toContain('Private')
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
