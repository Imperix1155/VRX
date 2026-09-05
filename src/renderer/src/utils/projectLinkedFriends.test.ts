import { describe, expect, it } from 'vitest'
import type { LinkedProfile } from '@shared/linkedProfiles'
import type { Friend, Platform, PresenceState } from '@shared/types'
import { projectLinkedFriends } from './projectLinkedFriends'

const ACCOUNT_IDS = { vrchat: 'vrc-account', chilloutvr: 'cvr-account' } as const

function friend(platform: Platform, id: string, name: string, state: PresenceState): Friend {
  const base = {
    platformUserId: id,
    platform,
    displayName: name,
    avatarUrl: null,
    presence: { state },
    status: platform === 'vrchat' ? 'online' : null,
    statusDescription: null,
    trustRank: null,
    instance: null,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null
  }
  // The projection ranks all three normalized states defensively. CVR currently
  // cannot emit `active`, but this fixture exercises that total ordering.
  return base as Friend
}

function profile(
  preferredPlatform: Platform = 'vrchat',
  customName: string | null = null
): LinkedProfile {
  return {
    id: 'person-1',
    members: [
      { platform: 'vrchat', platformAccountId: ACCOUNT_IDS.vrchat, friendId: 'vrc-friend' },
      { platform: 'chilloutvr', platformAccountId: ACCOUNT_IDS.chilloutvr, friendId: 'cvr-friend' }
    ],
    customName,
    defaultName: 'Stored name',
    preferredPlatform,
    pictureMode: 'preferred',
    sharedNote: '',
    revision: 1
  }
}

function input(
  vrcState: PresenceState,
  cvrState: PresenceState,
  options: { preferredPlatform?: Platform; filter?: 'all' | Platform; search?: string } = {}
): Parameters<typeof projectLinkedFriends>[0] & { vrc: Friend; cvr: Friend } {
  const vrc = friend('vrchat', 'vrc-friend', 'VRC Alias', vrcState)
  const cvr = friend('chilloutvr', 'cvr-friend', 'CVR Alias', cvrState)
  return {
    friends: [vrc, cvr],
    profiles: [profile(options.preferredPlatform)],
    accountIds: ACCOUNT_IDS,
    filter: options.filter ?? 'all',
    search: options.search ?? '',
    vrc,
    cvr
  }
}

const states: PresenceState[] = ['in-game', 'active', 'offline']
const platforms: Platform[] = ['vrchat', 'chilloutvr']
const expectedSections: Record<PresenceState, Record<PresenceState, string[]>> = {
  'in-game': {
    'in-game': ['in-game'],
    active: ['in-game', 'online'],
    offline: ['in-game']
  },
  active: {
    'in-game': ['in-game', 'online'],
    active: ['online'],
    offline: ['online']
  },
  offline: {
    'in-game': ['in-game'],
    active: ['online'],
    offline: ['offline']
  }
}

describe('projectLinkedFriends', () => {
  it.each(
    states.flatMap((vrc) =>
      states.flatMap((cvr) =>
        platforms.map((preferredPlatform) => [vrc, cvr, preferredPlatform] as const)
      )
    )
  )(
    'projects %s/%s for %s preference with the approved presence shape',
    (vrcState, cvrState, preferredPlatform) => {
      const result = projectLinkedFriends(input(vrcState, cvrState, { preferredPlatform }))
      expect(result.rows.map((row) => row.section)).toEqual(expectedSections[vrcState][cvrState])
      expect(result.personCount).toBe(1)
      expect(result.onlinePeople).toBe(vrcState === 'offline' && cvrState === 'offline' ? 0 : 1)
      expect(result.rows.every((row) => row.personKey === 'person:person-1')).toBe(true)
      const mixed =
        (vrcState === 'in-game' && cvrState === 'active') ||
        (vrcState === 'active' && cvrState === 'in-game')
      expect(result.rows.every((row) => row.target.kind === (mixed ? 'account' : 'person'))).toBe(
        true
      )
    }
  )

  it.each(['vrchat', 'chilloutvr'] as const)(
    'filters every presence pair and preference to the selected %s account',
    (filter) => {
      for (const vrcState of states) {
        for (const cvrState of states) {
          for (const preferredPlatform of ['vrchat', 'chilloutvr'] as const) {
            const { vrc, cvr, ...projection } = input(vrcState, cvrState, {
              filter,
              preferredPlatform
            })
            const result = projectLinkedFriends(projection)
            expect(result.rows).toHaveLength(1)
            expect(result.rows[0]?.accounts).toEqual([filter === 'vrchat' ? vrc : cvr])
            expect(result.rows[0]?.name).toBe(
              filter === 'vrchat' ? vrc.displayName : cvr.displayName
            )
            expect(result.rows[0]?.target).toMatchObject({ kind: 'account', personId: 'person-1' })
          }
        }
      }
    }
  )

  it('counts people globally rather than adding split section entries', () => {
    const result = projectLinkedFriends(input('in-game', 'active'))
    expect(result.rows).toHaveLength(2)
    expect(result.personCount).toBe(1)
    expect(result.onlinePeople).toBe(1)
  })

  it('does not treat a missing account as an offline account', () => {
    const { cvr, ...projection } = input('active', 'offline')
    const result = projectLinkedFriends({
      ...projection,
      friends: projection.friends.filter((item) => item !== cvr)
    })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.accounts).toEqual([projection.vrc])
    expect(result.rows[0]?.section).toBe('online')
    expect(result.personCount).toBe(1)
  })

  it('keeps an unscoped raw friend independent without fabricating its missing linked member', () => {
    const { vrc, cvr, ...projection } = input('active', 'offline')
    const result = projectLinkedFriends({
      ...projection,
      accountIds: { vrchat: ACCOUNT_IDS.vrchat }
    })
    expect(result.rows.map((row) => row.accounts)).toEqual([[vrc], [cvr]])
    expect(result.rows.map((row) => row.target)).toEqual([
      {
        kind: 'person',
        personId: 'person-1',
        anchor: { platform: 'vrchat', friendId: 'vrc-friend' }
      },
      {
        kind: 'account',
        account: { platform: 'chilloutvr', friendId: 'cvr-friend' },
        personId: null
      }
    ])
  })

  it('requires the signed-in account ID before resolving a member', () => {
    const { vrc, cvr, ...projection } = input('active', 'active')
    const result = projectLinkedFriends({
      ...projection,
      accountIds: { vrchat: 'different-vrc-account', chilloutvr: ACCOUNT_IDS.chilloutvr }
    })
    expect(result.rows.map((row) => row.accounts)).toEqual([[cvr], [vrc]])
    expect(result.rows.every((row) => row.personKey === 'person:person-1')).toBe(false)
    expect(result.personCount).toBe(2)
  })

  it('matches both scoped account aliases and a custom name without bypassing a platform filter', () => {
    const { vrc, ...projection } = input('active', 'offline', {
      filter: 'vrchat',
      search: 'cvr alias'
    })
    const custom = projectLinkedFriends({
      ...projection,
      profiles: [profile('vrchat', 'VRX Alias')],
      search: 'vrx alias'
    })
    expect(custom.rows).toHaveLength(1)
    expect(custom.rows[0]?.accounts).toEqual([vrc])

    const byOtherAlias = projectLinkedFriends({ ...projection, search: 'cvr alias' })
    expect(byOtherAlias.rows).toHaveLength(1)
    expect(byOtherAlias.rows[0]?.accounts).toEqual([vrc])
  })

  it('uses account targets only for the mixed in-game and online pair', () => {
    const result = projectLinkedFriends(input('in-game', 'active'))
    expect(result.rows.map((row) => row.name)).toEqual(['VRC Alias', 'CVR Alias'])
    expect(result.rows.map((row) => row.target)).toEqual([
      {
        kind: 'account',
        account: { platform: 'vrchat', friendId: 'vrc-friend' },
        personId: 'person-1'
      },
      {
        kind: 'account',
        account: { platform: 'chilloutvr', friendId: 'cvr-friend' },
        personId: 'person-1'
      }
    ])
  })

  it('does not infer a link from matching display names', () => {
    const result = projectLinkedFriends({
      friends: [
        friend('vrchat', 'unlinked-vrc', 'Same Name', 'active'),
        friend('chilloutvr', 'unlinked-cvr', 'Same Name', 'active')
      ],
      profiles: [],
      accountIds: ACCOUNT_IDS,
      filter: 'all',
      search: ''
    })
    expect(result.rows).toHaveLength(2)
    expect(result.personCount).toBe(2)
    expect(result.rows.map((row) => row.target.kind)).toEqual(['account', 'account'])
  })
})
