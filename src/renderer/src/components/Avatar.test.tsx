// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Friend } from '@shared/types'
import '../i18n'

const avatarData = vi.hoisted(() => ({ current: null as string | null }))
vi.mock('../hooks/useAvatar', () => ({ useAvatar: () => avatarData.current }))

import { Avatar } from './FriendsList'

const friend: Friend = {
  platformUserId: 'usr_avatar',
  platform: 'vrchat',
  displayName: 'Alice',
  avatarUrl: 'https://files.vrchat.cloud/avatar/alice.png',
  presence: { state: 'active' },
  status: 'online',
  statusDescription: null,
  instance: null,
  trustRank: null,
  isFavorite: false,
  favoriteGroupIds: [],
  linkedPersonId: null
}

afterEach(() => {
  cleanup()
  avatarData.current = null
})

describe('Avatar', () => {
  it('swaps the initial placeholder for a rounded image and falls back on image error', () => {
    const view = render(<Avatar friend={friend} />)
    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.queryByRole('img', { hidden: true })?.tagName).toBe('SPAN')

    avatarData.current = 'data:image/png;base64,YXZhdGFy'
    view.rerender(<Avatar friend={friend} />)
    const image = view.container.querySelector('img')
    expect(image?.getAttribute('src')).toBe(avatarData.current)
    expect(image?.className).toContain('object-cover')
    expect(screen.queryByText('A')).toBeNull()

    if (image) fireEvent.error(image)
    expect(screen.getByText('A')).toBeTruthy()
    expect(view.container.querySelector('img')).toBeNull()
  })
})
