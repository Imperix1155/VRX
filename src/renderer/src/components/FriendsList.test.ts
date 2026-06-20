import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Friend } from '@shared/types'
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
})
