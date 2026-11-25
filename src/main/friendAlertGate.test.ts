/**
 * Do not disturb and per-friend alert types share one gate. These cases drive
 * FriendAlerts through that gate and the account's stored choices.
 */
import { describe, expect, it, vi } from 'vitest'
import { alertsMuted } from '@shared/doNotDisturb'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import type { Friend, InstanceInfo, PresenceState } from '@shared/types'
import type { OwnStatus } from '@shared/ownProfile'
import { AccountSession } from './services/accountSession'
import { FriendAlerts } from './services/friendAlerts'
import { FriendAlertPicks } from './services/friendAlertPicks'
import { SocialStore, type SocialStoreStorage } from './services/socialStore'
import { createShowAlert, isFriendAlertEnabled, type NativeAlert } from './friendNotifications'

vi.mock('electron', () => {
  const api = { Notification: class {}, app: {}, ipcMain: {}, shell: {} }
  return { default: api, ...api }
})
vi.mock('electron-store', () => ({ default: class {} }))

class MemorySocialStorage implements SocialStoreStorage {
  value: unknown = {}
  read(): unknown {
    return this.value
  }
  write(value: unknown): void {
    this.value = structuredClone(value)
  }
}

const NOW = 1_700_000_000_000

function friend(
  platformUserId: string,
  displayName: string,
  state: PresenceState,
  currentInstance: InstanceInfo | null = null
): Friend {
  return {
    platformUserId,
    platform: 'vrchat',
    displayName,
    avatarUrl: null,
    presence: { state },
    instance: currentInstance,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null,
    status: 'online',
    statusDescription: null,
    trustRank: null
  }
}

function world(): InstanceInfo {
  return {
    worldId: 'wrld_one',
    instanceId: 'one',
    worldName: 'The Great Pug',
    thumbnailUrl: null,
    type: 'public',
    openness: 'public',
    isGroup: false,
    groupName: null,
    groupId: null,
    groupImageUrl: null,
    region: null,
    userCount: null
  }
}

function harness(input: { settings: Settings; ownStatus?: OwnStatus | null; storage?: unknown }): {
  desktop: NativeAlert[]
  vr: NativeAlert[]
  engine: FriendAlerts
  show: (alert: NativeAlert) => boolean
  picks: FriendAlertPicks
} {
  const session = new AccountSession()
  session.setIdentity('vrchat', 'usr_me')
  const storage = new MemorySocialStorage()
  if (input.storage !== undefined) storage.value = input.storage
  const picks = new FriendAlertPicks(session, new SocialStore(session, storage))
  const desktop: NativeAlert[] = []
  const vr: NativeAlert[] = []
  const show = createShowAlert({
    getSettings: () => input.settings,
    ownStatus: () => input.ownStatus ?? null,
    now: () => NOW,
    picks,
    deliver: (alert) => {
      desktop.push(alert)
      vr.push(alert)
    }
  })
  const engine = new FriendAlerts({
    notify: show,
    clock: () => 0,
    isEnabled: (type) => isFriendAlertEnabled(type, input.settings),
    isFriendIncluded: () => true,
    resolveName: () => null
  })
  return { desktop, vr, engine, show, picks }
}

function alertsOn(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    notifyFriendOnline: true,
    notifyFriendInGame: true,
    notifyFriendOffline: true
  }
}

const names = (alerts: NativeAlert[]): string[] =>
  alerts.map((alert) =>
    alert.type === 'inbox'
      ? `inbox:${alert.item.kind}`
      : `${alert.type}:${'platformUserId' in alert ? alert.platformUserId : 'group'}`
  )

describe('showAlert gate', () => {
  it('during Do not disturb, a bypass friend fires only their enabled types and a normal friend stays quiet', () => {
    const { desktop, vr, engine, show, picks } = harness({
      settings: {
        ...alertsOn(),
        doNotDisturb: 'until-off',
        notifyInvites: true,
        notifyHotInstance: true
      }
    })
    const revision = picks.list('vrchat').revision
    picks.setFriendAlert('vrchat', ['usr_a'], { kind: 'bypass', enabled: true }, revision)
    picks.setFriendAlert(
      'vrchat',
      ['usr_a'],
      { kind: 'type', type: 'offline', enabled: false },
      revision
    )

    engine.consume({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: friend('usr_a', 'Ada', 'offline')
    })
    engine.consume({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: friend('usr_a', 'Ada', 'active')
    })
    engine.consume({ type: 'friend-offline', platform: 'vrchat', platformUserId: 'usr_a' })
    engine.consume({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: friend('usr_b', 'Bea', 'offline')
    })
    engine.consume({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: friend('usr_b', 'Bea', 'active')
    })
    expect(
      show({
        type: 'inbox',
        item: {
          id: 'inv_1',
          platform: 'vrchat',
          kind: 'invite',
          senderId: 'usr_c',
          senderName: 'Cy',
          worldName: null,
          receivedAt: NOW
        }
      })
    ).toBe(false)
    expect(
      show({
        type: 'hot-instance',
        platform: 'vrchat',
        instanceId: 'one',
        friendCount: 3,
        worldName: 'The Great Pug'
      })
    ).toBe(false)

    expect(names(desktop)).toEqual(['online:usr_a'])
    expect(names(vr)).toEqual(['online:usr_a'])
    expect(
      alertsMuted({
        doNotDisturb: 'until-off',
        doNotDisturbUntil: null,
        doNotDisturbFollowStatus: false,
        ownStatus: null,
        now: NOW
      })
    ).toBe(true)
  })

  it('honors a bypass while Follow my status is muting', () => {
    const { desktop, vr, engine, picks } = harness({
      settings: { ...alertsOn(), doNotDisturbFollowStatus: true },
      ownStatus: 'dnd'
    })
    picks.setFriendAlert(
      'vrchat',
      ['usr_a'],
      { kind: 'bypass', enabled: true },
      picks.list('vrchat').revision
    )
    engine.consume({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: friend('usr_a', 'Ada', 'offline')
    })
    engine.consume({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: friend('usr_a', 'Ada', 'active')
    })
    engine.consume({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: friend('usr_b', 'Bea', 'offline')
    })
    engine.consume({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: friend('usr_b', 'Bea', 'active')
    })
    expect(names(desktop)).toEqual(['online:usr_a'])
    expect(names(vr)).toEqual(names(desktop))
  })

  it('gives friend A online only and friend B all three, and a global Off still suppresses', () => {
    const { desktop, vr, engine, picks } = harness({ settings: alertsOn() })
    const revision = picks.list('vrchat').revision
    picks.setFriendAlert(
      'vrchat',
      ['usr_a'],
      { kind: 'type', type: 'in-game', enabled: false },
      revision
    )
    picks.setFriendAlert(
      'vrchat',
      ['usr_a'],
      { kind: 'type', type: 'offline', enabled: false },
      revision
    )

    const place = world()
    engine.consume({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: friend('usr_a', 'Ada', 'offline')
    })
    engine.consume({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: friend('usr_a', 'Ada', 'in-game', place)
    })
    engine.consume({ type: 'friend-offline', platform: 'vrchat', platformUserId: 'usr_a' })

    engine.consume({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: friend('usr_b', 'Bea', 'offline')
    })
    engine.consume({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: friend('usr_b', 'Bea', 'active')
    })
    engine.consume({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: friend('usr_b', 'Bea', 'in-game', place)
    })
    engine.consume({ type: 'friend-offline', platform: 'vrchat', platformUserId: 'usr_b' })

    expect(names(desktop)).toEqual([
      'online:usr_a',
      'online:usr_b',
      'in-game:usr_b',
      'offline:usr_b'
    ])
    expect(names(vr)).toEqual(names(desktop))

    const quiet = harness({ settings: { ...alertsOn(), notifyFriendOnline: false } })
    quiet.picks.setFriendAlert(
      'vrchat',
      ['usr_a'],
      { kind: 'type', type: 'online', enabled: true },
      quiet.picks.list('vrchat').revision
    )
    quiet.engine.consume({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: friend('usr_a', 'Ada', 'offline')
    })
    quiet.engine.consume({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: friend('usr_a', 'Ada', 'active')
    })
    expect(
      quiet.show({
        type: 'online',
        platform: 'vrchat',
        platformUserId: 'usr_a',
        displayName: 'Ada',
        worldName: null
      })
    ).toBe(false)
    expect(names(quiet.desktop)).toEqual([])
    expect(names(quiet.vr)).toEqual([])
  })

  it('loads an older friend-alert file with every type on and no bypass', () => {
    const { picks, engine, desktop } = harness({
      settings: alertsOn(),
      storage: {
        storeFormatVersion: 1,
        accounts: {
          'vrchat:usr_me': {
            socialPrefs: {
              schemaVersion: 1,
              platform: 'vrchat',
              platformAccountId: 'usr_me',
              data: { followedFriendIds: ['usr_a'] }
            }
          }
        }
      }
    })
    expect(picks.isTypeEnabled('vrchat', 'usr_a', 'online')).toBe(true)
    expect(picks.isTypeEnabled('vrchat', 'usr_a', 'in-game')).toBe(true)
    expect(picks.isTypeEnabled('vrchat', 'usr_a', 'offline')).toBe(true)
    expect(picks.bypassesDoNotDisturb('vrchat', 'usr_a')).toBe(false)
    expect(picks.isPicked('vrchat', 'usr_a')).toBe(true)
    engine.consume({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: friend('usr_a', 'Ada', 'offline')
    })
    engine.consume({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: friend('usr_a', 'Ada', 'active')
    })
    expect(names(desktop)).toEqual(['online:usr_a'])
  })
})
