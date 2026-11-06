import { describe, expect, it } from 'vitest'
import type { InboxItem } from '@shared/inbox'
import { countNewInboxItems, relativeInboxTime, scopeInboxItems } from './inbox'

const item = (platform: InboxItem['platform'], receivedAt: number): InboxItem => ({
  id: `invite:${platform}-${receivedAt}`,
  platform,
  kind: 'invite',
  senderId: 'usr_a',
  senderName: 'Alice',
  worldName: null,
  receivedAt
})

describe('inbox helpers', () => {
  const items = [item('chilloutvr', 30), item('vrchat', 20), item('chilloutvr', 10)]

  it('scopes rows to the platform filter', () => {
    expect(scopeInboxItems(items, 'all')).toEqual(items)
    expect(scopeInboxItems(items, 'vrchat').map((i) => i.receivedAt)).toEqual([20])
    expect(scopeInboxItems(items, 'chilloutvr').map((i) => i.receivedAt)).toEqual([30, 10])
  })

  it('counts rows newer than the last one on screen', () => {
    expect(countNewInboxItems(items, { vrchat: 0, chilloutvr: 0 })).toBe(3)
    // Seeing ChilloutVR's newest row says nothing about VRChat's.
    expect(countNewInboxItems(items, { vrchat: 0, chilloutvr: 30 })).toBe(1)
    expect(countNewInboxItems(items, { vrchat: 20, chilloutvr: 10 })).toBe(1)
    expect(countNewInboxItems(items, { vrchat: 20, chilloutvr: 30 })).toBe(0)
  })

  it('words the age, with under a minute left to the caller', () => {
    const now = 10 * 24 * 60 * 60_000
    expect(relativeInboxTime(now - 30_000, now, 'en')).toBeNull()
    expect(relativeInboxTime(now + 60_000, now, 'en')).toBeNull()
    expect(relativeInboxTime(now - 5 * 60_000, now, 'en')).toBe('5 minutes ago')
    expect(relativeInboxTime(now - 3 * 60 * 60_000, now, 'en')).toBe('3 hours ago')
    expect(relativeInboxTime(now - 2 * 24 * 60 * 60_000, now, 'en')).toBe('2 days ago')
    expect(relativeInboxTime(now - 5 * 60_000, now, 'ja')).toBe('5 分前')
  })
})
