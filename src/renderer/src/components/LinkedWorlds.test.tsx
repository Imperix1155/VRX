// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Friend, InstanceInfo } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import '../i18n'
import { useSettingsStore } from '../stores/settings'
import { useAvatar } from '../hooks/useAvatar'
import LinkedWorlds from './LinkedWorlds'

vi.mock('../hooks/useAvatar', () => ({ useAvatar: vi.fn() }))
const avatar = vi.mocked(useAvatar)
const instance: InstanceInfo = {
  worldId: 'world',
  instanceId: 'world:1',
  worldName: 'World',
  thumbnailUrl: 'https://fixture',
  type: 'public',
  openness: 'public',
  isGroup: false,
  groupName: null,
  groupId: null,
  groupImageUrl: null,
  region: null,
  userCount: null
}
function friend(platform: Friend['platform'], id: string, world = instance): Friend {
  return platform === 'vrchat'
    ? {
        platform,
        platformUserId: id,
        displayName: id,
        avatarUrl: null,
        presence: { state: 'in-game' },
        status: 'online',
        statusDescription: null,
        trustRank: null,
        instance: world,
        isFavorite: false,
        favoriteGroupIds: [],
        linkedPersonId: null
      }
    : {
        platform,
        platformUserId: id,
        displayName: id,
        avatarUrl: null,
        presence: { state: 'in-game' },
        status: null,
        statusDescription: null,
        trustRank: null,
        instance: world,
        isFavorite: false,
        favoriteGroupIds: [],
        linkedPersonId: null
      }
}
beforeEach(() => {
  avatar.mockReset()
  avatar.mockReturnValue('data:image/png;base64,fixture')
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false })
})
afterEach(cleanup)

describe('LinkedWorlds', () => {
  it('renders two row world groups with platform short labels', () => {
    render(
      <LinkedWorlds
        variant="row"
        accounts={[
          friend('vrchat', 'vrc'),
          friend('chilloutvr', 'cvr', { ...instance, worldName: 'CVR World' })
        ]}
      />
    )
    expect(screen.getByText('World')).toBeTruthy()
    expect(screen.getByText('CVR World')).toBeTruthy()
    expect(screen.getByText('VRC')).toBeTruthy()
    expect(screen.getByText('CVR')).toBeTruthy()
  })
  it('omits non-ingame accounts and keeps hidden locations neutral', () => {
    const hidden = {
      ...friend('vrchat', 'hidden'),
      status: 'dnd' as const
    } as Extract<Friend, { platform: 'vrchat' }>
    const offline = {
      ...friend('chilloutvr', 'offline'),
      presence: { state: 'offline' as const },
      instance: null
    }
    render(<LinkedWorlds variant="row" accounts={[hidden, offline]} />)
    expect(screen.getByText('Hidden')).toBeTruthy()
    expect(document.querySelector('[data-linked-world-group] span:last-child')?.textContent).toBe(
      'Hidden'
    )
    expect(screen.queryByText('Public')).toBeNull()
    expect(avatar).not.toHaveBeenCalled()
    const drawer = render(<LinkedWorlds variant="drawer" accounts={[hidden]} />)
    expect(drawer.container.querySelector('[data-instance-pill]')).toBeNull()
    expect(drawer.container.querySelector('img')).toBeNull()
  })
  it('positions two drawer worlds diagonally and uses cached avatar data only', () => {
    const { container } = render(
      <LinkedWorlds
        variant="drawer"
        accounts={[friend('vrchat', 'vrc'), friend('chilloutvr', 'cvr')]}
      />
    )
    expect(container.querySelector('[data-linked-world-position="vrc-upper-right"]')).toBeTruthy()
    expect(container.querySelector('[data-linked-world-position="cvr-lower-left"]')).toBeTruthy()
    expect(
      container.querySelector('[data-linked-world-layer="vrchat"]')?.getAttribute('style')
    ).toContain('clip-path')
    expect(
      container.querySelector('[data-linked-world-layer="chilloutvr"]')?.getAttribute('style')
    ).toContain('clip-path')
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'data:image/png;base64,fixture'
    )
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelectorAll('img')).toHaveLength(1)
  })

  it('never starts an avatar request for the compact row variant', () => {
    render(<LinkedWorlds variant="row" accounts={[friend('vrchat', 'vrc')]} />)
    expect(avatar).not.toHaveBeenCalled()
  })
  it('keeps a single CVR world at the upper-right with its own outline', () => {
    const { container } = render(
      <LinkedWorlds variant="drawer" accounts={[friend('chilloutvr', 'cvr')]} />
    )
    const overlay = container.querySelector('[data-linked-world-position="single"]')!
    expect(overlay.className).toContain('linked-world-upper')
    expect(container.querySelector('.linked-world-outline')?.className).toContain(
      'linked-platform-chilloutvr'
    )
    expect(container.querySelector<HTMLElement>('[data-linked-world-layer]')?.style.clipPath).toBe(
      ''
    )
  })
  it('keeps hidden VRChat text in its own corner without leaking its pill or image', () => {
    const hidden = { ...friend('vrchat', 'hidden'), status: 'dnd' } as Extract<
      Friend,
      { platform: 'vrchat' }
    >
    const { container } = render(
      <LinkedWorlds variant="drawer" accounts={[hidden, friend('chilloutvr', 'visible')]} />
    )
    const upper = container.querySelector('[data-linked-world-position="vrc-upper-right"]')!
    expect(upper.textContent).toBe('Hidden')
    expect(upper.querySelector('[data-instance-pill]')).toBeNull()
    expect(container.querySelector('[data-linked-world-layer="vrchat"] img')).toBeNull()
    expect(container.querySelectorAll('[data-instance-pill]')).toHaveLength(1)
  })
  it('recovers after an image source changes and preserves honest unknown labels in every scheme', () => {
    const account = friend('chilloutvr', 'cvr', {
      ...instance,
      type: 'owner-must-invite',
      opennessUnknown: true
    })
    const view = render(<LinkedWorlds variant="drawer" accounts={[account]} />)
    fireEvent.error(view.container.querySelector('img')!)
    expect(view.container.querySelector('img')).toBeNull()
    view.rerender(
      <LinkedWorlds
        variant="drawer"
        accounts={[
          { ...account, instance: { ...account.instance!, thumbnailUrl: 'https://new-fixture' } }
        ]}
      />
    )
    expect(view.container.querySelector('img')).not.toBeNull()
    expect(screen.getByText('Unknown')).toBeTruthy()
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, labelScheme: 'platform-native' } })
    view.rerender(<LinkedWorlds variant="drawer" accounts={[account]} />)
    expect(screen.getByText('Unknown')).toBeTruthy()
  })
})
