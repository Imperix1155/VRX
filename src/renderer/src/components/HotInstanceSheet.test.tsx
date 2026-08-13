// @vitest-environment jsdom
/**
 * HotInstanceSheet (VRX-250 / VRX-260) — bottom-sheet rendering for a hot
 * instance, including the group card in the meta stack.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Friend, InstanceInfo, Platform } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import '../i18n'
import { useSettingsStore } from '../stores/settings'
import HotInstanceSheet from './HotInstanceSheet'
import type { HotInstance } from '../utils/dashboardAggregations'

const groupInstance: InstanceInfo = {
  worldId: 'wrld_group',
  instanceId: 'wrld_group:1~group(grp_pals)~groupAccessType(plus)',
  worldName: 'Group Hangout',
  thumbnailUrl: 'https://example.com/world.png',
  type: 'group-plus',
  openness: 'friends-plus',
  isGroup: true,
  groupName: 'Pixel Pals',
  groupId: 'grp_pals',
  groupImageUrl: 'https://example.com/group.png',
  region: 'us',
  userCount: 4
}

const cvrGroupInstance: InstanceInfo = {
  worldId: 'wrld_cvr',
  instanceId: 'i+cvrgroup',
  worldName: 'CVR Group World',
  thumbnailUrl: 'https://example.com/cvrworld.png',
  type: 'friends-of-members',
  openness: 'friends-plus',
  isGroup: true,
  groupName: 'CVR Crew',
  groupId: 'grp_cvr',
  groupImageUrl: 'https://files.chilloutvr.net/g/cvr.png',
  region: null,
  userCount: 3
}

function makeFriend(platform: Platform, displayName: string, instance: InstanceInfo): Friend {
  const base = {
    platformUserId: `usr_${displayName.toLowerCase()}`,
    displayName,
    avatarUrl: null,
    presence: { state: 'in-game' } as const,
    instance,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null
  }
  if (platform === 'chilloutvr') {
    return { ...base, platform, status: null, statusDescription: null, trustRank: null }
  }
  return {
    ...base,
    platform,
    status: 'online',
    statusDescription: null,
    trustRank: 'known'
  }
}

function makeHotInstance(overrides?: Partial<HotInstance>): HotInstance {
  const members = [makeFriend('vrchat', 'Alex', groupInstance)]
  return {
    worldId: groupInstance.worldId,
    worldName: groupInstance.worldName,
    instanceId: groupInstance.instanceId,
    instanceType: groupInstance.type,
    isGroup: true,
    groupName: groupInstance.groupName,
    groupId: groupInstance.groupId,
    groupImageUrl: groupInstance.groupImageUrl,
    thumbnailUrl: groupInstance.thumbnailUrl,
    platform: 'vrchat',
    friendCount: members.length,
    friendNames: members.map((m) => m.displayName),
    members,
    groupKey: 'vrchat key',
    ...overrides
  }
}

function makeCvrHotInstance(overrides?: Partial<HotInstance>): HotInstance {
  const members = [makeFriend('chilloutvr', 'Alex', cvrGroupInstance)]
  return makeHotInstance({
    worldId: cvrGroupInstance.worldId,
    worldName: cvrGroupInstance.worldName,
    instanceId: cvrGroupInstance.instanceId,
    instanceType: cvrGroupInstance.type,
    isGroup: true,
    groupName: cvrGroupInstance.groupName,
    groupId: cvrGroupInstance.groupId,
    groupImageUrl: cvrGroupInstance.groupImageUrl,
    thumbnailUrl: cvrGroupInstance.thumbnailUrl,
    platform: 'chilloutvr',
    friendCount: members.length,
    friendNames: members.map((m) => m.displayName),
    members,
    groupKey: 'cvr key',
    ...overrides
  })
}

function stubIntersectionObserver(): { trigger: () => void } {
  let callback: ((entries: { isIntersecting: boolean }[]) => void) | null = null
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        callback = cb
      }
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
  )
  return {
    trigger: () => {
      if (callback) callback([{ isIntersecting: true }])
    }
  }
}

describe('HotInstanceSheet', () => {
  beforeEach(() => {
    window.vrx = {
      getAvatar: vi.fn().mockResolvedValue({ ok: true, dataUrl: 'data:image/png;base64,group' })
    } as unknown as Window['vrx']
    useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders the group card with name and image for a populated group instance', async () => {
    const { trigger } = stubIntersectionObserver()
    render(<HotInstanceSheet instance={makeHotInstance()} onClose={() => {}} />)

    act(() => trigger())
    await waitFor(() =>
      expect(window.vrx!.getAvatar).toHaveBeenCalledWith('https://example.com/group.png')
    )

    const card = screen.getByTestId('hot-sheet-group-card')
    expect(card).toBeTruthy()
    expect(within(card).getByText('Pixel Pals')).toBeTruthy()
    // role="img" is what exposes the aria-label as an accessible name — a
    // generic div would not (CodeRabbit, VRX-260).
    expect(card.getAttribute('role')).toBe('img')
    expect(card.getAttribute('aria-label')).toBe('Hosted by Pixel Pals')
    const nameSpan = within(card).getByText('Pixel Pals')
    expect(nameSpan.getAttribute('title')).toBe('Pixel Pals')
    const img = card.querySelector('img')
    expect(img).toBeTruthy()
    expect(img!.getAttribute('src')).toBe('data:image/png;base64,group')
  })

  it('omits the group card when the group has no name', () => {
    stubIntersectionObserver()
    render(<HotInstanceSheet instance={makeHotInstance({ groupName: null })} onClose={() => {}} />)

    expect(screen.queryByTestId('hot-sheet-group-card')).toBeNull()
  })

  it('renders a group card for a ChilloutVR instance with verified group fields', async () => {
    const { trigger } = stubIntersectionObserver()
    render(<HotInstanceSheet instance={makeCvrHotInstance()} onClose={() => {}} />)

    act(() => trigger())
    await waitFor(() =>
      expect(window.vrx!.getAvatar).toHaveBeenCalledWith('https://files.chilloutvr.net/g/cvr.png')
    )

    const card = screen.getByTestId('hot-sheet-group-card')
    expect(card).toBeTruthy()
    expect(within(card).getByText('CVR Crew')).toBeTruthy()
  })

  it('omits the group card for a ChilloutVR instance with null group fields', () => {
    stubIntersectionObserver()
    render(
      <HotInstanceSheet
        instance={makeCvrHotInstance({ groupName: null, groupId: null, groupImageUrl: null })}
        onClose={() => {}}
      />
    )

    expect(screen.queryByTestId('hot-sheet-group-card')).toBeNull()
  })

  it('closes when the scrim is clicked', () => {
    stubIntersectionObserver()
    const onClose = vi.fn()
    render(<HotInstanceSheet instance={makeHotInstance()} onClose={onClose} />)

    fireEvent.pointerDown(screen.getByTestId('hot-sheet-scrim'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
