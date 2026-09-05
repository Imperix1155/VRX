// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Friend } from '@shared/types'
import '../i18n'

const avatarData = vi.hoisted(() => ({ byUrl: new Map<string, string>() }))
vi.mock('../hooks/useAvatar', () => ({
  useAvatar: (url: string | null) => (url ? (avatarData.byUrl.get(url) ?? null) : null)
}))

import { Avatar } from './Avatar'

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

const mergedFriend: Friend = {
  ...friend,
  platformUserId: 'usr_merged',
  platform: 'chilloutvr',
  displayName: 'Bob',
  avatarUrl: 'https://files.abinteractive.net/avatar/bob.png',
  status: null,
  statusDescription: null,
  trustRank: null,
  presence: { state: 'in-game' }
}

afterEach(() => {
  cleanup()
  avatarData.byUrl.clear()
})

describe('status badge (VRX-69 — empty colored dot, glyph retired)', () => {
  const badges = (container: HTMLElement): HTMLElement[] => [
    ...container.querySelectorAll<HTMLElement>('span.border-2')
  ]

  it.each([
    ['join-me', '--st-joinme'],
    ['online', '--st-online'],
    ['ask-me', '--st-askme'],
    ['dnd', '--st-dnd']
  ] as const)('renders exactly one EMPTY badge in the status color for %s', (status, token) => {
    // In-game: status folds into the ring only in a world (presence-first,
    // VRX-69 review fix).
    const { container } = render(
      <Avatar friend={{ ...friend, status, presence: { state: 'in-game' } }} />
    )
    const found = badges(container)
    // Badge presence unchanged: exactly one per status …
    expect(found).toHaveLength(1)
    // … but with NO svg glyph inside (count, not find — VRX-69), anywhere.
    expect(found[0]?.querySelectorAll('svg')).toHaveLength(0)
    expect(container.querySelectorAll('svg')).toHaveLength(0)
    // Ring color still keys the badge fill.
    expect(found[0]?.getAttribute('style') ?? '').toContain(`var(${token})`)
  })

  it('renders an empty web-active badge on the presence palette', () => {
    const { container } = render(
      <Avatar friend={{ ...friend, status: null, presence: { state: 'active' } }} />
    )
    const found = badges(container)
    expect(found).toHaveLength(1)
    expect(container.querySelectorAll('svg')).toHaveLength(0)
    expect(found[0]?.getAttribute('style') ?? '').toContain('var(--active)')
  })

  it('renders NO badge for an offline friend', () => {
    const { container } = render(
      <Avatar friend={{ ...friend, status: null, presence: { state: 'offline' } }} />
    )
    expect(badges(container)).toHaveLength(0)
    expect(container.querySelectorAll('svg')).toHaveLength(0)
  })

  // Presence-first fold (VRX-69 review fix of a pre-existing latent bug): the
  // WS friend-offline path RETAINS the cached status — it must never paint
  // the ring or badge of a friend who is not in a world.
  it('offline with a retained VRChat status stays on the offline ring — no badge', () => {
    const { container } = render(
      <Avatar friend={{ ...friend, status: 'ask-me', presence: { state: 'offline' } }} />
    )
    expect(badges(container)).toHaveLength(0)
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Offline')
    expect(container.innerHTML).not.toContain('var(--st-askme)')
    expect(container.innerHTML).toContain('var(--offline)')
  })

  it('offline CVR friend stays on the offline ring too (platform parity)', () => {
    const cvrOffline = {
      ...friend,
      platform: 'chilloutvr',
      status: null,
      statusDescription: null,
      trustRank: null,
      presence: { state: 'offline' }
    } as Friend
    const { container } = render(<Avatar friend={cvrOffline} />)
    expect(badges(container)).toHaveLength(0)
    expect(container.innerHTML).toContain('var(--offline)')
  })

  it('web-active with a retained status keeps the Active ring (presence wins)', () => {
    const { container } = render(
      <Avatar friend={{ ...friend, status: 'join-me', presence: { state: 'active' } }} />
    )
    const found = badges(container)
    expect(found).toHaveLength(1)
    expect(found[0]?.getAttribute('style') ?? '').toContain('var(--active)')
    expect(container.innerHTML).not.toContain('var(--st-joinme)')
  })

  it('renders no badge at the drawer size (64px header avatar)', () => {
    const { container } = render(<Avatar friend={friend} variant="drawer" />)
    expect(badges(container)).toHaveLength(0)
    expect(container.querySelector('.h-\\[64px\\]')).not.toBeNull()
  })

  it('scales the ring and badge proportionally at the small size (24px sheet chip)', () => {
    const { container } = render(
      <Avatar friend={{ ...friend, status: 'join-me' }} variant="small" />
    )
    // The face (placeholder or image) carries the scaled ring.
    const face = container.querySelector('[style*="0 0 0 1.5px"]')
    expect(face).not.toBeNull()
    expect(face?.className).toContain('h-[24px]')
    // Badge scaled from 16px @ 42px → 9px @ 24px.
    const badge = container.querySelector('.h-\\[9px\\]')
    expect(badge).not.toBeNull()
  })
})

describe('Avatar', () => {
  it('swaps the initial placeholder for a rounded image and falls back on image error', () => {
    const view = render(<Avatar friend={friend} />)
    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.queryByRole('img', { hidden: true })?.tagName).toBe('SPAN')

    avatarData.byUrl.set(friend.avatarUrl!, 'data:image/png;base64,YXZhdGFy')
    view.rerender(<Avatar friend={friend} />)
    const image = view.container.querySelector('img')
    expect(image?.getAttribute('src')).toBe('data:image/png;base64,YXZhdGFy')
    expect(image?.className).toContain('object-cover')
    expect(screen.queryByText('A')).toBeNull()

    if (image) fireEvent.error(image)
    expect(screen.getByText('A')).toBeTruthy()
    expect(view.container.querySelector('img')).toBeNull()
  })

  it('clips opposite-platform pictures into fixed VRChat and ChilloutVR triangles', () => {
    avatarData.byUrl.set(friend.avatarUrl!, 'data:image/png;base64,VlJD')
    avatarData.byUrl.set(mergedFriend.avatarUrl!, 'data:image/png;base64,Q1ZS')

    const { container } = render(<Avatar friend={mergedFriend} mergedWith={friend} />)
    const vrchatHalf = container.querySelector<HTMLElement>('[data-avatar-platform="vrchat"]')
    const chilloutvrHalf = container.querySelector<HTMLElement>(
      '[data-avatar-platform="chilloutvr"]'
    )

    expect(vrchatHalf?.style.clipPath).toBe('polygon(0 0, 100% 0, 100% 100%)')
    expect(chilloutvrHalf?.style.clipPath).toBe('polygon(0 0, 0 100%, 100% 100%)')
    expect(vrchatHalf?.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,VlJD')
    expect(chilloutvrHalf?.querySelector('img')?.getAttribute('src')).toBe(
      'data:image/png;base64,Q1ZS'
    )
    expect(container.querySelectorAll('[style*="box-shadow"]')).toHaveLength(1)
  })

  it('keeps the other half visible after an error and recovers for new data or source', () => {
    avatarData.byUrl.set(friend.avatarUrl!, 'data:image/png;base64,VlJD')
    avatarData.byUrl.set(mergedFriend.avatarUrl!, 'data:image/png;base64,Q1ZS')
    const view = render(<Avatar friend={friend} mergedWith={mergedFriend} />)
    const vrchatImage = view.container.querySelector<HTMLImageElement>(
      '[data-avatar-platform="vrchat"] img'
    )
    if (vrchatImage) fireEvent.error(vrchatImage)

    expect(view.container.querySelector('[data-avatar-platform="vrchat"] img')).toBeNull()
    expect(view.container.querySelector('[data-avatar-platform="chilloutvr"] img')).not.toBeNull()
    expect(screen.getByText('A')).toBeTruthy()

    avatarData.byUrl.set(friend.avatarUrl!, 'data:image/png;base64,UkVGUkVTSA==')
    view.rerender(<Avatar friend={{ ...friend }} mergedWith={mergedFriend} />)
    const refreshedImage = view.container.querySelector<HTMLImageElement>(
      '[data-avatar-platform="vrchat"] img'
    )
    expect(refreshedImage?.getAttribute('src')).toBe('data:image/png;base64,UkVGUkVTSA==')
    if (refreshedImage) fireEvent.error(refreshedImage)

    const updatedFriend = {
      ...friend,
      avatarUrl: 'https://files.vrchat.cloud/avatar/alice-new.png'
    }
    avatarData.byUrl.set(updatedFriend.avatarUrl, 'data:image/png;base64,TkVX')
    view.rerender(<Avatar friend={updatedFriend} mergedWith={mergedFriend} />)

    expect(
      view.container.querySelector('[data-avatar-platform="vrchat"] img')?.getAttribute('src')
    ).toBe('data:image/png;base64,TkVX')
  })

  it('renders an initial fallback independently in a missing merged half', () => {
    avatarData.byUrl.set(friend.avatarUrl!, 'data:image/png;base64,VlJD')

    const { container } = render(<Avatar friend={friend} mergedWith={mergedFriend} />)

    expect(container.querySelector('[data-avatar-platform="vrchat"] img')).not.toBeNull()
    expect(container.querySelector('[data-avatar-platform="chilloutvr"] img')).toBeNull()
    expect(screen.getByText('B')).toBeTruthy()
  })

  it('takes the ring, badge, and accessible status only from friend', () => {
    const offline = {
      ...friend,
      presence: { state: 'offline' as const },
      status: 'join-me' as const
    }
    const { container } = render(<Avatar friend={offline} mergedWith={mergedFriend} />)

    expect(screen.getByRole('img', { name: 'Offline' })).toBeTruthy()
    expect(container.querySelector('[style*="var(--offline)"]')).not.toBeNull()
    expect(container.innerHTML).not.toContain('var(--st-online)')
    expect(container.querySelectorAll('[style*="box-shadow"]')).toHaveLength(1)
    expect(container.querySelectorAll('span.border-2')).toHaveLength(0)
  })
})
