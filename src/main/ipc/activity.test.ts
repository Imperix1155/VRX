import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { ActivityFeed } from '../services/activityFeed'
import type { FriendLog } from '../services/friendLog'
import type { InstanceLog } from '../services/instanceLog'

const handlers = new Map<string, (event: unknown, req?: unknown) => unknown>()
const trusted = vi.hoisted(() => ({ value: true }))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, req?: unknown) => unknown) => {
      handlers.set(channel, fn)
    })
  }
}))
vi.mock('./security', () => ({ isTrustedIpcSender: vi.fn(() => trusted.value) }))

import { registerActivityHandlers } from './activity'

const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent
const entry = {
  id: 1,
  kind: 'online',
  platform: 'vrchat',
  platformUserId: 'usr_a',
  displayName: 'Alice',
  worldName: null,
  at: 1
}
let feed: {
  list: ReturnType<typeof vi.fn>
  page: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
  clearAll: ReturnType<typeof vi.fn>
}
let friendLog: { facts: ReturnType<typeof vi.fn> }
let instanceLog: Record<'page' | 'people' | 'met' | 'clear', ReturnType<typeof vi.fn>>

beforeEach(() => {
  handlers.clear()
  trusted.value = true
  feed = {
    list: vi.fn(() => [entry]),
    page: vi.fn(() => ({ entries: [entry], hasMore: false })),
    clear: vi.fn(),
    clearAll: vi.fn()
  }
  friendLog = {
    facts: vi.fn((platform: string, friendId: string) => ({
      platform,
      friendId,
      since: 5,
      sinceKnown: true,
      previousNames: []
    }))
  }
  instanceLog = {
    page: vi.fn(() => ({ visits: [], hasMore: false })),
    people: vi.fn(() => []),
    met: vi.fn(() => null),
    clear: vi.fn()
  }
  registerActivityHandlers(
    feed as unknown as ActivityFeed,
    friendLog as unknown as FriendLog,
    instanceLog as unknown as InstanceLog
  )
})

describe('activity handlers', () => {
  it('rejects untrusted senders on every channel', () => {
    trusted.value = false
    for (const channel of [
      'get-activity',
      'get-activity-page',
      'get-friend-history',
      'get-instance-visits',
      'get-instance-visit-people',
      'clear-instance-log',
      'clear-activity'
    ]) {
      expect(() => handlers.get(channel)!(event, { platforms: ['vrchat'], filter: 'all' })).toThrow(
        'Untrusted IPC sender'
      )
    }
    expect(feed.list).not.toHaveBeenCalled()
    expect(feed.page).not.toHaveBeenCalled()
    expect(feed.clear).not.toHaveBeenCalled()
    expect(feed.clearAll).not.toHaveBeenCalled()
    expect(friendLog.facts).not.toHaveBeenCalled()
    expect(instanceLog.page).not.toHaveBeenCalled()
    expect(instanceLog.people).not.toHaveBeenCalled()
    expect(instanceLog.clear).not.toHaveBeenCalled()
  })

  it('reads one page for the scope the page names, and nothing else', () => {
    expect(
      handlers.get('get-activity-page')!(event, {
        scope: [
          { platform: 'vrchat', beforeId: 41, accountKey: 'vrchat:usr_someone' },
          { platform: 'chilloutvr', beforeId: null }
        ],
        filter: 'world',
        // Anything else a caller adds never reaches the service.
        accountKey: 'vrchat:usr_someone',
        limit: 100_000
      })
    ).toEqual({ entries: [entry], hasMore: false })
    expect(feed.page).toHaveBeenCalledWith({
      scope: [
        { platform: 'vrchat', beforeId: 41 },
        { platform: 'chilloutvr', beforeId: null }
      ],
      filter: 'world'
    })

    handlers.get('get-activity-page')!(event, {
      scope: [{ platform: 'vrchat', beforeId: null }],
      filter: 'all',
      friends: [
        { platform: 'vrchat', friendId: 'usr_a', extra: true },
        { platform: 'chilloutvr', friendId: 'friend-1' }
      ]
    })
    expect(feed.page).toHaveBeenLastCalledWith({
      scope: [{ platform: 'vrchat', beforeId: null }],
      filter: 'all',
      friends: [
        { platform: 'vrchat', friendId: 'usr_a' },
        { platform: 'chilloutvr', friendId: 'friend-1' }
      ]
    })

    handlers.get('get-activity-page')!(event, {
      scope: [{ platform: 'vrchat', beforeId: null }],
      filter: 'world',
      query: { text: '  Night  ', from: 10, to: 20, extra: true }
    })
    expect(feed.page).toHaveBeenLastCalledWith({
      scope: [{ platform: 'vrchat', beforeId: null }],
      filter: 'world',
      query: { text: 'Night', from: 10, to: 20 }
    })
  })

  const vrc = (beforeId: unknown): unknown => [{ platform: 'vrchat', beforeId }]
  it.each([
    ['no request', undefined],
    ['no scope', { filter: 'all' }],
    ['an empty scope', { scope: [], filter: 'all' }],
    ['a scope that is not a list', { scope: 'vrchat', filter: 'all' }],
    ['an unknown platform', { scope: [{ platform: 'steam', beforeId: null }], filter: 'all' }],
    [
      'the same platform twice',
      { scope: [...(vrc(null) as unknown[]), ...(vrc(5) as unknown[])], filter: 'all' }
    ],
    ['an unknown kind', { scope: vrc(null), filter: 'renamed' }],
    ['no place to read from', { scope: [{ platform: 'vrchat' }], filter: 'all' }],
    ['an id that is not a whole number', { scope: vrc(1.5), filter: 'all' }],
    ['an id below one', { scope: vrc(0), filter: 'all' }],
    ['an id as text', { scope: vrc('7'), filter: 'all' }],
    ['friends that are not a list', { scope: vrc(null), filter: 'all', friends: 'usr_a' }],
    ['an empty friends list', { scope: vrc(null), filter: 'all', friends: [] }],
    [
      'too many friends',
      {
        scope: vrc(null),
        filter: 'all',
        friends: [1, 2, 3].map((n) => ({ platform: 'vrchat', friendId: `usr_${n}` }))
      }
    ],
    [
      'a friend on an unknown platform',
      { scope: vrc(null), filter: 'all', friends: [{ platform: 'steam', friendId: 'a' }] }
    ],
    [
      'a friend id with other characters',
      { scope: vrc(null), filter: 'all', friends: [{ platform: 'vrchat', friendId: "a' OR 1=1" }] }
    ],
    [
      'a friend id that is too long',
      {
        scope: vrc(null),
        filter: 'all',
        friends: [{ platform: 'vrchat', friendId: 'a'.repeat(129) }]
      }
    ],
    ['a request that is not a plain object', Object.create({ scope: vrc(null) }) as unknown],
    ['a search that is not text', { scope: vrc(null), filter: 'all', query: { text: 1 } }],
    [
      'a search that is too long',
      { scope: vrc(null), filter: 'all', query: { text: 'a'.repeat(101) } }
    ],
    [
      'a date that is not a whole moment',
      { scope: vrc(null), filter: 'all', query: { from: 1.5 } }
    ],
    ['a date that is text', { scope: vrc(null), filter: 'all', query: { to: '2026-01-01' } }]
  ])('refuses a page request with %s and reads nothing', (_label, request) => {
    expect(() => handlers.get('get-activity-page')!(event, request)).toThrow(
      'Invalid get-activity-page request'
    )
    expect(feed.page).not.toHaveBeenCalled()
  })

  it('returns the list and ignores any request payload', () => {
    expect(handlers.get('get-activity')!(event, { platform: 'vrchat' })).toEqual([entry])
    expect(feed.list).toHaveBeenCalledWith()
  })

  it("reads what is saved about one friend, or a linked person's two accounts", () => {
    expect(
      handlers.get('get-friend-history')!(event, {
        friends: [
          { platform: 'vrchat', friendId: 'usr_a' },
          { platform: 'chilloutvr', friendId: 'id-1' }
        ]
      })
    ).toEqual([
      {
        platform: 'vrchat',
        friendId: 'usr_a',
        since: 5,
        sinceKnown: true,
        previousNames: [],
        met: null
      },
      {
        platform: 'chilloutvr',
        friendId: 'id-1',
        since: 5,
        sinceKnown: true,
        previousNames: [],
        met: null
      }
    ])
    expect(friendLog.facts).toHaveBeenCalledTimes(2)
    expect(instanceLog.met).toHaveBeenCalledWith('chilloutvr', 'id-1')
  })

  it('reads the instance log for the scope the page names', () => {
    handlers.get('get-instance-visits')!(event, {
      scope: [
        { platform: 'vrchat', before: null },
        { platform: 'chilloutvr', before: 1_700_000_000_000 }
      ],
      accountKey: 'vrchat:someone-else'
    })
    expect(instanceLog.page).toHaveBeenCalledExactlyOnceWith({
      scope: [
        { platform: 'vrchat', before: null },
        { platform: 'chilloutvr', before: 1_700_000_000_000 }
      ]
    })
    handlers.get('get-instance-visits')!(event, {
      scope: [{ platform: 'vrchat', before: null }],
      query: { text: 'Lounge', from: 5, to: 9 }
    })
    expect(instanceLog.page).toHaveBeenLastCalledWith({
      scope: [{ platform: 'vrchat', before: null }],
      query: { text: 'Lounge', from: 5, to: 9 }
    })
    handlers.get('get-instance-visit-people')!(event, { platform: 'vrchat', visitId: 7 })
    expect(instanceLog.people).toHaveBeenCalledExactlyOnceWith('vrchat', 7)
    handlers.get('clear-instance-log')!(event, { platforms: ['chilloutvr'] })
    expect(instanceLog.clear).toHaveBeenCalledExactlyOnceWith(['chilloutvr'])
  })

  it.each([
    ['get-instance-visits', undefined],
    ['get-instance-visits', { scope: [] }],
    ['get-instance-visits', { scope: [{ platform: 'steam', before: null }] }],
    ['get-instance-visits', { scope: [{ platform: 'vrchat', before: '5' }] }],
    ['get-instance-visits', { scope: [{ platform: 'vrchat' }] }],
    [
      'get-instance-visits',
      { scope: [{ platform: 'vrchat', before: null }], query: { from: 1.2 } }
    ],
    [
      'get-instance-visits',
      {
        scope: [
          { platform: 'vrchat', before: null },
          { platform: 'vrchat', before: 5 }
        ]
      }
    ],
    ['get-instance-visit-people', { platform: 'vrchat', visitId: 0 }],
    ['get-instance-visit-people', { platform: 'vrchat', visitId: 1.5 }],
    ['get-instance-visit-people', { platform: 'steam', visitId: 1 }],
    ['get-instance-visit-people', { platform: 'vrchat', visitId: '1' }],
    ['clear-instance-log', { platforms: [] }],
    ['clear-instance-log', { platforms: ['steam'] }],
    ['clear-instance-log', undefined]
  ])('refuses a bad %s request and touches nothing', (channel, request) => {
    expect(() => handlers.get(channel)!(event, request)).toThrow(`Invalid ${channel} request`)
    expect(instanceLog.page).not.toHaveBeenCalled()
    expect(instanceLog.people).not.toHaveBeenCalled()
    expect(instanceLog.clear).not.toHaveBeenCalled()
  })

  it.each([
    ['no request', undefined],
    ['no friends', {}],
    ['an empty list', { friends: [] }],
    ['too many friends', { friends: Array(3).fill({ platform: 'vrchat', friendId: 'usr_a' }) }],
    ['an unknown platform', { friends: [{ platform: 'steam', friendId: 'usr_a' }] }],
    ['an id that is not a plain id', { friends: [{ platform: 'vrchat', friendId: "a' OR 1" }] }],
    ['an id that is too long', { friends: [{ platform: 'vrchat', friendId: 'a'.repeat(129) }] }]
  ])('refuses a friend history request with %s', (_label, request) => {
    expect(() => handlers.get('get-friend-history')!(event, request)).toThrow(
      'Invalid get-friend-history request'
    )
    expect(friendLog.facts).not.toHaveBeenCalled()
  })

  it('clears only the platforms and the kind the page shows', () => {
    expect(
      handlers.get('clear-activity')!(event, { platforms: ['chilloutvr'], filter: 'world' })
    ).toBeUndefined()
    expect(feed.clear).toHaveBeenCalledWith(['chilloutvr'], 'world')
    handlers.get('clear-activity')!(event, { platforms: ['vrchat', 'chilloutvr'], filter: 'all' })
    expect(feed.clear).toHaveBeenLastCalledWith(['vrchat', 'chilloutvr'], 'all')
    expect(feed.clearAll).not.toHaveBeenCalled()
  })

  it.each([
    ['no request', undefined],
    ['no platforms', { platforms: [], filter: 'all' }],
    ['an unknown platform', { platforms: ['steam'], filter: 'all' }],
    ['too many platforms', { platforms: ['vrchat', 'chilloutvr', 'vrchat'], filter: 'all' }],
    ['platforms that are not a list', { platforms: 'vrchat', filter: 'all' }],
    ['an unknown kind', { platforms: ['vrchat'], filter: 'renamed' }],
    ['no kind', { platforms: ['vrchat'] }],
    ['a request that is not a plain object', Object.create({ platforms: ['vrchat'] }) as unknown]
  ])('refuses %s and clears nothing', (_label, request) => {
    expect(() => handlers.get('clear-activity')!(event, request)).toThrow(
      'Invalid clear-activity request'
    )
    expect(feed.clear).not.toHaveBeenCalled()
    expect(feed.clearAll).not.toHaveBeenCalled()
  })
})
