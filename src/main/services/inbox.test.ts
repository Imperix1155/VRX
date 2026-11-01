import { describe, expect, it, vi } from 'vitest'
import {
  MAX_INBOX_DISMISSED_PER_PLATFORM,
  MAX_INBOX_ITEMS_PER_PLATFORM,
  type InboxEntry,
  type InboxKind
} from '@shared/inbox'
import type { AdapterEvent, Friend, Platform } from '@shared/types'
import { INBOX_ALERT_LIMIT, INBOX_ALERT_WINDOW_MS, InboxService } from './inbox'

function rig(alerts: Partial<Record<InboxKind, boolean>> = {}): {
  inbox: InboxService
  onChanged: ReturnType<typeof vi.fn>
  notify: ReturnType<typeof vi.fn>
  advance: (ms: number) => void
} {
  let wall = 1_000_000
  let mono = 0
  const onChanged = vi.fn()
  const notify = vi.fn()
  const inbox = new InboxService({
    now: () => wall,
    clock: () => mono,
    onChanged,
    notify,
    isAlertEnabled: (kind) => alerts[kind] === true
  })
  return {
    inbox,
    onChanged,
    notify,
    advance: (ms) => {
      wall += ms
      mono += ms
    }
  }
}

const entry = (overrides: Partial<InboxEntry> = {}): InboxEntry => ({
  sourceId: 'not_1',
  kind: 'invite',
  senderId: 'usr_a',
  senderName: 'Alice',
  worldName: 'Pug Lounge',
  ...overrides
})

const add = (platform: Platform, ...entries: InboxEntry[]): AdapterEvent => ({
  type: 'inbox',
  platform,
  change: { op: 'add', entries }
})

const friend = (platform: Platform, platformUserId: string): Friend => ({
  platform,
  platformUserId,
  displayName: 'Friend',
  avatarUrl: null,
  status: null,
  statusDescription: null,
  trustRank: null,
  presence: { state: 'offline' },
  instance: null,
  isFavorite: false,
  favoriteGroupIds: [],
  linkedPersonId: null
})

describe('InboxService', () => {
  it('keeps both platforms, newest first, with main-issued IDs and arrival times', () => {
    const r = rig()
    r.inbox.consume(add('vrchat', entry()))
    r.advance(5_000)
    r.inbox.consume(
      add('chilloutvr', entry({ sourceId: 'req-1', kind: 'friend-request', worldName: null }))
    )

    expect(r.inbox.snapshot().items).toEqual([
      {
        id: 'friend-request:req-1',
        platform: 'chilloutvr',
        kind: 'friend-request',
        senderId: 'usr_a',
        senderName: 'Alice',
        worldName: null,
        receivedAt: 1_005_000
      },
      {
        id: 'invite:not_1',
        platform: 'vrchat',
        kind: 'invite',
        senderId: 'usr_a',
        senderName: 'Alice',
        worldName: 'Pug Lounge',
        receivedAt: 1_000_000
      }
    ])
    expect(r.onChanged).toHaveBeenCalledTimes(2)
  })

  it('treats a replay as the same row: no new time, no change unless names moved', () => {
    const r = rig({ invite: true })
    r.inbox.consume(add('chilloutvr', entry()))
    r.advance(1_000)
    r.inbox.consume(add('chilloutvr', entry()))
    expect(r.onChanged).toHaveBeenCalledTimes(1)
    expect(r.notify).toHaveBeenCalledTimes(1)

    r.inbox.consume(add('chilloutvr', entry({ senderName: 'Alice B' })))
    expect(r.onChanged).toHaveBeenCalledTimes(2)
    expect(r.inbox.snapshot().items[0]).toMatchObject({
      senderName: 'Alice B',
      receivedAt: 1_000_000
    })
  })

  it('keeps one row per sender and kind, and a replaced invite stays hidden', () => {
    const r = rig()
    r.inbox.consume(add('chilloutvr', entry({ sourceId: 'inv-1', worldName: 'Old' })))
    r.inbox.consume(add('chilloutvr', entry({ sourceId: 'inv-2', worldName: 'New' })))
    r.inbox.consume(add('chilloutvr', entry({ sourceId: 'inv-1', worldName: 'Old' })))

    expect(r.inbox.snapshot().items.map((item) => item.worldName)).toEqual(['New'])
  })

  it('removes rows answered elsewhere and clears on clear-all, without remembering them', () => {
    const r = rig()
    r.inbox.consume(add('vrchat', entry(), entry({ sourceId: 'not_2', senderId: 'usr_b' })))
    r.inbox.consume({
      type: 'inbox',
      platform: 'vrchat',
      change: { op: 'remove', sourceIds: ['not_1'] }
    })
    expect(r.inbox.snapshot().items.map((item) => item.id)).toEqual(['invite:not_2'])

    r.inbox.consume({ type: 'inbox', platform: 'vrchat', change: { op: 'clear' } })
    expect(r.inbox.snapshot().items).toEqual([])
    // A removal is not a dismissal: the record may come back.
    r.inbox.consume(add('vrchat', entry()))
    expect(r.inbox.snapshot().items).toHaveLength(1)
  })

  it('drops a friend request once that person becomes a friend', () => {
    const r = rig()
    r.inbox.consume(
      add('vrchat', entry({ sourceId: 'not_9', kind: 'friend-request', senderId: 'usr_z' }))
    )
    r.inbox.consume(add('vrchat', entry({ sourceId: 'not_8', senderId: 'usr_z' })))
    r.inbox.consume({ type: 'friend-added', platform: 'vrchat', friend: friend('vrchat', 'usr_z') })

    expect(r.inbox.snapshot().items.map((item) => item.kind)).toEqual(['invite'])
  })

  it('a roster read settles requests from people who are friends now', () => {
    const r = rig()
    r.inbox.consume(
      add(
        'chilloutvr',
        entry({ sourceId: 'g1', kind: 'friend-request', senderId: 'g1' }),
        entry({ sourceId: 'g2', kind: 'friend-request', senderId: 'g2' }),
        entry({ sourceId: 'inv', senderId: 'g1' })
      )
    )
    r.onChanged.mockClear()
    r.inbox.settleRoster('vrchat', [friend('vrchat', 'g1')])
    expect(r.onChanged).not.toHaveBeenCalled()

    r.inbox.settleRoster('chilloutvr', [friend('chilloutvr', 'g1')])
    expect(
      r.inbox
        .snapshot()
        .items.map((item) => item.id)
        .sort()
    ).toEqual(['friend-request:g2', 'invite:inv'])
    expect(r.onChanged).toHaveBeenCalledOnce()
  })

  it('dismiss and clear hide rows locally, and a replay stays hidden', () => {
    const r = rig()
    r.inbox.consume(add('chilloutvr', entry()))
    r.inbox.consume(add('vrchat', entry()))
    expect(r.inbox.dismiss('chilloutvr', 'invite:not_1')).toBe(true)
    expect(r.inbox.dismiss('chilloutvr', 'invite:not_1')).toBe(false)
    r.inbox.consume(add('chilloutvr', entry()))
    expect(r.inbox.snapshot().items.map((item) => item.platform)).toEqual(['vrchat'])

    r.inbox.clear(['vrchat'])
    r.inbox.consume(add('vrchat', entry()))
    expect(r.inbox.snapshot().items).toEqual([])
  })

  it('a boundary forgets the platform completely, the other platform untouched', () => {
    const r = rig()
    r.inbox.consume(add('vrchat', entry()))
    r.inbox.consume(add('chilloutvr', entry()))
    r.inbox.dismiss('vrchat', 'invite:not_1')
    r.inbox.consume(add('vrchat', entry({ sourceId: 'not_2', senderId: 'usr_b' })))

    r.inbox.resetPlatform('vrchat')
    expect(r.inbox.snapshot().items.map((item) => item.platform)).toEqual(['chilloutvr'])
    // The new account may legitimately receive the same record ID.
    r.inbox.consume(add('vrchat', entry()))
    expect(r.inbox.snapshot().items).toHaveLength(2)
  })

  it('bounds rows and remembered dismissals per platform', () => {
    const r = rig()
    const many = Array.from({ length: MAX_INBOX_ITEMS_PER_PLATFORM + 10 }, (_, i) =>
      entry({ sourceId: `not_${i}`, senderId: `usr_${i}` })
    )
    r.inbox.consume(add('vrchat', ...many))
    const items = r.inbox.snapshot().items
    expect(items).toHaveLength(MAX_INBOX_ITEMS_PER_PLATFORM)
    expect(items.some((item) => item.id === 'invite:not_0')).toBe(false)

    for (let round = 0; round < 6; round++) {
      r.inbox.consume(
        add(
          'vrchat',
          ...Array.from({ length: 50 }, (_, i) =>
            entry({ sourceId: `d${round}_${i}`, senderId: `usr_d${round}_${i}` })
          )
        )
      )
      r.inbox.clear(['vrchat'])
    }
    // The earliest dismissals were forgotten, so that record can return.
    r.inbox.consume(add('vrchat', entry({ sourceId: 'd0_0', senderId: 'usr_d0_0' })))
    expect(r.inbox.snapshot().items).toHaveLength(1)
    expect(MAX_INBOX_DISMISSED_PER_PLATFORM).toBeLessThan(300)
  })

  it('alerts only when switched on, per kind, read at dispatch', () => {
    const switches: Partial<Record<InboxKind, boolean>> = {}
    const notify = vi.fn()
    const inbox = new InboxService({
      now: () => 0,
      clock: () => 0,
      onChanged: vi.fn(),
      notify,
      isAlertEnabled: (kind) => switches[kind] === true
    })
    inbox.consume(add('vrchat', entry()))
    expect(notify).not.toHaveBeenCalled()

    switches['friend-request'] = true
    inbox.consume(
      add('vrchat', entry({ sourceId: 'not_2', kind: 'friend-request', senderId: 'usr_b' }))
    )
    inbox.consume(add('vrchat', entry({ sourceId: 'not_3', senderId: 'usr_c' })))
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'friend-request' }))
  })

  it('rate limits alerts per platform and per sender', () => {
    const r = rig({ invite: true })
    for (let i = 0; i < INBOX_ALERT_LIMIT + 2; i++) {
      r.inbox.consume(add('vrchat', entry({ sourceId: `not_${i}`, senderId: `usr_${i}` })))
    }
    expect(r.notify).toHaveBeenCalledTimes(INBOX_ALERT_LIMIT)

    // ChilloutVR has its own budget.
    r.inbox.consume(add('chilloutvr', entry()))
    expect(r.notify).toHaveBeenCalledTimes(INBOX_ALERT_LIMIT + 1)

    r.advance(INBOX_ALERT_WINDOW_MS + 1)
    r.inbox.consume(add('vrchat', entry({ sourceId: 'not_x', senderId: 'usr_x' })))
    r.inbox.consume(add('vrchat', entry({ sourceId: 'not_y', senderId: 'usr_x' })))
    expect(r.notify).toHaveBeenCalledTimes(INBOX_ALERT_LIMIT + 2)
  })

  it('a throwing switch or notifier never breaks the inbox', () => {
    const inbox = new InboxService({
      now: () => 0,
      clock: () => 0,
      onChanged: vi.fn(),
      notify: () => {
        throw new Error('native boom')
      },
      isAlertEnabled: () => true
    })
    expect(() => inbox.consume(add('vrchat', entry()))).not.toThrow()
    expect(inbox.snapshot().items).toHaveLength(1)
  })

  it('ignores unrelated events', () => {
    const r = rig()
    r.inbox.consume({ type: 'roster-changed', platform: 'chilloutvr' })
    r.inbox.consume({ type: 'connection', platform: 'vrchat', health: 'live' })
    expect(r.onChanged).not.toHaveBeenCalled()
  })
})

describe('InboxService friend request lookup', () => {
  it('hands friend actions the record behind a friend request row only', () => {
    const r = rig()
    r.inbox.consume(
      add(
        'vrchat',
        entry({ sourceId: 'not_fr', kind: 'friend-request', senderId: 'usr_b', worldName: null }),
        entry({ sourceId: 'not_inv' })
      )
    )
    expect(r.inbox.friendRequest('vrchat', 'friend-request:not_fr')).toEqual({
      sourceId: 'not_fr',
      senderId: 'usr_b'
    })
    expect(r.inbox.friendRequest('vrchat', 'invite:not_inv')).toBeNull()
    expect(r.inbox.friendRequest('chilloutvr', 'friend-request:not_fr')).toBeNull()
    expect(r.inbox.dismiss('vrchat', 'friend-request:not_fr')).toBe(true)
    expect(r.inbox.friendRequest('vrchat', 'friend-request:not_fr')).toBeNull()
  })
})
