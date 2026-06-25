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

describe('FriendsList', () => {
  beforeEach(() => {
    useFriends.mockReturnValue({
      data: [friend],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn()
    })
  })

  it('renders the VRChat status pill separately from the presence state dot', () => {
    const markup = renderToStaticMarkup(createElement(FriendsList))

    expect(markup).toContain('bg-[var(--active)]')
  })

  it.each([
    ['join-me', 'Join Me', 'joinme'],
    ['online', 'Online', 'online'],
    ['ask-me', 'Ask Me', 'askme'],
    ['dnd', 'Do Not Disturb', 'dnd']
  ] as const)(
    'renders %s with a label, fixed hue, and semantic text token',
    (status, label, token) => {
      useFriends.mockReturnValue({
        data: [{ ...friend, status }],
        isPending: false,
        isError: false,
        isFetching: false,
        refetch: vi.fn()
      })

      const markup = renderToStaticMarkup(createElement(FriendsList))

      expect(markup).toContain(label)
      expect(markup).toContain(`bg-[var(--st-${token})]`)
      expect(markup).toContain(`text-[var(--st-${token}-text)]`)
    }
  )

  it('does not render a status pill for ChilloutVR data', () => {
    useFriends.mockReturnValue({
      data: [
        {
          ...friend,
          platform: 'chilloutvr',
          status: 'join-me',
          statusDescription: 'Come hang out!'
        } as unknown as Friend
      ],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn()
    })

    const markup = renderToStaticMarkup(createElement(FriendsList))

    expect(markup).not.toContain('Join Me')
    expect(markup).not.toContain('Come hang out!')
  })

  it('renders world name and instance type label when friend has an instance', () => {
    useFriends.mockReturnValue({
      data: [{ ...friend, instance: publicInstance }],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn()
    })

    const markup = renderToStaticMarkup(createElement(FriendsList))

    expect(markup).toContain('The Great Pug')
    expect(markup).toContain('Public')
  })

  it('renders unknown world fallback when worldName is null but instance is present', () => {
    useFriends.mockReturnValue({
      data: [{ ...friend, instance: { ...publicInstance, worldName: null } }],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn()
    })

    const markup = renderToStaticMarkup(createElement(FriendsList))

    expect(markup).toContain('Unknown World')
    expect(markup).toContain('Public')
  })

  it('renders no instance subline when instance is null', () => {
    const markup = renderToStaticMarkup(createElement(FriendsList))

    expect(markup).not.toContain('The Great Pug')
    expect(markup).not.toContain('Unknown World')
  })

  // ─── VRX-166: hide-world rule (§5 R6) ──────────────────────────────────────

  it('hides world and shows custom status for ask-me friend (exactly once)', () => {
    const askMeFriend: Friend = {
      ...friend,
      status: 'ask-me',
      statusDescription: 'taking commissions',
      instance: publicInstance
    }
    useFriends.mockReturnValue({
      data: [askMeFriend],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn()
    })

    const markup = renderToStaticMarkup(createElement(FriendsList))

    // World name must NOT appear
    expect(markup).not.toContain('The Great Pug')
    // Custom status text must appear exactly once
    const count = (markup.match(/taking commissions/g) ?? []).length
    expect(count).toBe(1)
  })

  it('hides world and shows custom status for dnd friend (exactly once)', () => {
    const dndFriend: Friend = {
      ...friend,
      status: 'dnd',
      statusDescription: 'in meeting',
      instance: publicInstance
    }
    useFriends.mockReturnValue({
      data: [dndFriend],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn()
    })

    const markup = renderToStaticMarkup(createElement(FriendsList))

    expect(markup).not.toContain('The Great Pug')
    const count = (markup.match(/in meeting/g) ?? []).length
    expect(count).toBe(1)
  })

  it('shows no subline content for ask-me friend with null statusDescription', () => {
    const askMeFriend: Friend = {
      ...friend,
      status: 'ask-me',
      statusDescription: null,
      instance: publicInstance
    }
    useFriends.mockReturnValue({
      data: [askMeFriend],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn()
    })

    const markup = renderToStaticMarkup(createElement(FriendsList))

    // World must be hidden
    expect(markup).not.toContain('The Great Pug')
  })

  it('shows statusDescription on name line for join-me friend (not hidden, exactly once)', () => {
    // join-me is NOT ask-me/dnd — world stays; custom status appears on name line
    useFriends.mockReturnValue({
      data: [
        {
          ...friend,
          status: 'join-me',
          statusDescription: 'Come hang out!',
          instance: publicInstance
        }
      ],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn()
    })

    const markup = renderToStaticMarkup(createElement(FriendsList))

    // World is NOT hidden
    expect(markup).toContain('The Great Pug')
    // statusDescription appears exactly once
    const count = (markup.match(/Come hang out!/g) ?? []).length
    expect(count).toBe(1)
  })

  // ─── VRX-166: openness icon badge (§6) ─────────────────────────────────────

  it('renders openness icon badge (SVG) alongside world name in subline', () => {
    useFriends.mockReturnValue({
      data: [{ ...friend, instance: publicInstance }],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn()
    })

    const markup = renderToStaticMarkup(createElement(FriendsList))

    // Badge renders an SVG element for the icon
    expect(markup).toContain('<svg')
    // Label text present
    expect(markup).toContain('Public')
  })

  it.each([
    ['public', 'Public'],
    ['friends-plus', 'Friends+'],
    ['friends', 'Friends'],
    ['invite', 'Invite'],
    ['invite-plus', 'Invite+']
  ] as const)('renders openness badge label for %s instance type', (type, label) => {
    useFriends.mockReturnValue({
      data: [
        {
          ...friend,
          instance: { ...publicInstance, type, openness: 'public' as const }
        }
      ],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn()
    })

    const markup = renderToStaticMarkup(createElement(FriendsList))

    expect(markup).toContain(label)
  })

  // ─── VRX-166: platform spine + glyph ────────────────────────────────────────

  it('renders VRChat spine (--vrc color) for a VRChat friend', () => {
    const markup = renderToStaticMarkup(createElement(FriendsList))

    expect(markup).toContain('var(--vrc)')
  })

  it('renders CVR spine (--cvr color) for a CVR friend', () => {
    const cvrFriend: Friend = {
      ...friend,
      platform: 'chilloutvr',
      status: null,
      statusDescription: null,
      trustRank: null,
      presence: { state: 'in-game' }
    } as Friend
    useFriends.mockReturnValue({
      data: [cvrFriend],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn()
    })

    const markup = renderToStaticMarkup(createElement(FriendsList))

    expect(markup).toContain('var(--cvr)')
  })

  it('renders V glyph for VRChat friend and C glyph for CVR friend', () => {
    const cvrFriend: Friend = {
      ...friend,
      platform: 'chilloutvr',
      status: null,
      statusDescription: null,
      trustRank: null,
      presence: { state: 'in-game' }
    } as Friend

    const vrcMarkup = renderToStaticMarkup(createElement(FriendsList))
    expect(vrcMarkup).toContain('>V<')

    useFriends.mockReturnValue({
      data: [cvrFriend],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn()
    })
    const cvrMarkup = renderToStaticMarkup(createElement(FriendsList))
    expect(cvrMarkup).toContain('>C<')
  })
})
