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
import { getHotInstances, type HotInstance } from '../utils/dashboardAggregations'

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
    policySpace: 'private',
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
    policySpace: 'public',
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

  it('opennessUnknown renders the neutral "Unknown" banner pill instead of the degraded typed label (VRX-244)', () => {
    stubIntersectionObserver()
    render(
      <HotInstanceSheet
        instance={makeHotInstance({
          instanceType: 'invite',
          policySpace: 'unknown',
          opennessUnknown: true,
          isGroup: false,
          groupName: null,
          groupId: null,
          groupImageUrl: null
        })}
        onClose={() => {}}
      />
    )

    const banner = screen.getByTestId('hot-sheet-banner')
    const pill = banner.querySelector('[data-instance-pill]')
    expect(pill?.textContent).toBe('Unknown')
    expect((pill as HTMLElement).style.color).toBe('var(--text-dim)')
  })

  it('the instance pill and policy pill read the SAME carried unknown flag (VRX-244)', () => {
    // Regression for a review finding: the pill and the policy context used to read
    // two different members after `getHotInstances` sorts `members`
    // alphabetically — a founding member's degraded flag could paint the
    // pill "Unknown" while the secondary signal, reading a DIFFERENT
    // (alphabetically first) member, asserted a confident claim. Both must now
    // derive from the ONE carried `HotInstance.opennessUnknown` field.
    stubIntersectionObserver()
    const cleanMemberInstance: InstanceInfo = { ...groupInstance, type: 'invite', isGroup: false }
    render(
      <HotInstanceSheet
        instance={makeHotInstance({
          instanceType: 'invite',
          policySpace: 'unknown',
          opennessUnknown: true,
          isGroup: false,
          groupName: null,
          groupId: null,
          groupImageUrl: null,
          // The member array's own instance disagrees with the carried flag —
          // a stale/mismatched per-member snapshot must not leak through.
          members: [makeFriend('vrchat', 'Alex', cleanMemberInstance)]
        })}
        onClose={() => {}}
      />
    )

    const banner = screen.getByTestId('hot-sheet-banner')
    const pill = banner.querySelector('[data-instance-pill]')
    expect(pill?.textContent).toBe('Unknown')
    const policyPill = screen
      .getByTestId('hot-sheet-policy-space')
      .querySelector('[data-policy-space-pill]')
    expect(policyPill?.textContent).toBe('Unknown')
    expect(policyPill?.getAttribute('data-policy-space')).toBe('unknown')
  })

  it('the same instance WITHOUT opennessUnknown still renders its typed label (regression pin)', () => {
    stubIntersectionObserver()
    render(
      <HotInstanceSheet
        instance={makeHotInstance({
          instanceType: 'invite',
          isGroup: false,
          groupName: null,
          groupId: null,
          groupImageUrl: null
        })}
        onClose={() => {}}
      />
    )

    const banner = screen.getByTestId('hot-sheet-banner')
    const pill = banner.querySelector('[data-instance-pill]')
    expect(pill?.textContent).toBe('Invite')
    expect((pill as HTMLElement).style.color).toBe('var(--op-invite-text)')
  })

  it('renders policy space separately from the access-type pill', () => {
    stubIntersectionObserver()
    render(<HotInstanceSheet instance={makeHotInstance()} onClose={() => {}} />)

    const banner = screen.getByTestId('hot-sheet-banner')
    expect(banner.querySelector('[data-instance-pill]')?.textContent).toBe('Group+')
    const policyPill = screen.getByText('Private space')
    expect(policyPill.getAttribute('data-policy-space-pill')).toBe('')
    expect(policyPill.style.color).toBe('var(--policy-private-text)')
  })

  it('renders Unknown policy space when same-instance members disagree, regardless of arrival order', () => {
    stubIntersectionObserver()
    const publicInstance: InstanceInfo = {
      ...cvrGroupInstance,
      type: 'friends-of-members'
    }
    const unknownInstance: InstanceInfo = {
      ...cvrGroupInstance,
      type: 'members-only'
    }
    const publicMember = makeFriend('chilloutvr', 'Alex', publicInstance)
    const unknownMember = makeFriend('chilloutvr', 'Blair', unknownInstance)

    for (const members of [
      [publicMember, unknownMember],
      [unknownMember, publicMember]
    ]) {
      const hot = getHotInstances(members, 2)[0]
      expect(hot).toBeTruthy()
      const { unmount } = render(<HotInstanceSheet instance={hot!} onClose={() => {}} />)

      const policyPill = screen
        .getByTestId('hot-sheet-policy-space')
        .querySelector('[data-policy-space-pill]')
      expect(policyPill?.textContent).toBe('Unknown')
      expect(policyPill?.getAttribute('data-policy-space')).toBe('unknown')
      unmount()
    }
  })

  it('closes when the scrim is clicked', () => {
    stubIntersectionObserver()
    const onClose = vi.fn()
    render(<HotInstanceSheet instance={makeHotInstance()} onClose={onClose} />)

    fireEvent.pointerDown(screen.getByTestId('hot-sheet-scrim'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
