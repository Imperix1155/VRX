/**
 * What happens to saved activity when VRX closes and opens again.
 * Closing is `HistoryDatabase.close` (the quit path). Opening applies
 * `prune`, which is what startup does with the Keep for choice.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ActivityEntry, ActivityKeepFor } from '@shared/activity'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { ActivityHistory, FriendHistory } from './activityHistory'
import { HISTORY_FILE_NAME, HistoryDatabase, type SavedActivityRow } from './historyDatabase'

const DAY_MS = 86_400_000
const ACCOUNT = 'vrchat:usr_me'
const NOW = 1_000 * DAY_MS

function entry(id: number, at: number): ActivityEntry {
  return {
    id,
    kind: 'online',
    platform: 'vrchat',
    platformUserId: 'usr_a',
    displayName: 'Alice',
    worldName: 'Night Market',
    at
  }
}

function stored(id: number, at: number): SavedActivityRow {
  return {
    id,
    accountKey: ACCOUNT,
    kind: 'online',
    platformUserId: 'usr_a',
    displayName: 'Alice',
    worldName: 'Night Market',
    previousName: null,
    at
  }
}

describe('activity across a close and the next open', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function open(
    keepFor: ActivityKeepFor,
    path: string
  ): {
    database: HistoryDatabase
    history: ActivityHistory
    friends: FriendHistory
  } {
    const database = new HistoryDatabase({ path, now: () => NOW })
    const options = {
      database,
      accountKeyFor: () => ACCOUNT,
      keepFor: () => keepFor,
      now: () => NOW
    }
    return {
      database,
      history: new ActivityHistory(options),
      friends: new FriendHistory(options)
    }
  }

  it('keeps 90 days by default', () => {
    expect(DEFAULT_SETTINGS.activityKeepFor).toBe('90d')
  })

  it.each([
    ['30d', 10, 40],
    ['90d', 40, 100],
    ['1y', 100, 400],
    ['forever', 400, null]
  ] as const)(
    '%s keeps an event inside the window and drops one outside it, and quit itself deletes nothing',
    (keepFor, keptDays, droppedDays) => {
      const dir = mkdtempSync(join(tmpdir(), 'vrx-activity-keep-'))
      dirs.push(dir)
      const path = join(dir, HISTORY_FILE_NAME)
      const first = open(keepFor, path)
      expect(first.database.storage).toBe('file')
      first.history.append(entry(1, NOW - keptDays * DAY_MS))
      if (droppedDays !== null) first.history.append(entry(2, NOW - droppedDays * DAY_MS))
      first.database.saveFriends(ACCOUNT, [
        {
          platformUserId: 'usr_a',
          displayName: 'Alice',
          since: NOW - keptDays * DAY_MS,
          sinceKnown: true,
          misses: 0
        }
      ])
      const saved = first.database.recentActivity(ACCOUNT, 10).map((entry) => entry.id)
      expect(saved).toEqual(droppedDays === null ? [1] : [2, 1])
      first.database.close()

      const reopened = open(keepFor, path)
      expect(reopened.database.storage).toBe('file')
      expect(reopened.database.recentActivity(ACCOUNT, 10).map((entry) => entry.id)).toEqual(saved)
      reopened.history.prune()
      reopened.friends.prune()
      expect(reopened.database.recentActivity(ACCOUNT, 10).map((entry) => entry.id)).toEqual([1])
      expect(reopened.database.savedFriends(ACCOUNT).map((friend) => friend.displayName)).toEqual([
        'Alice'
      ])
      reopened.database.close()
    }
  )

  it('saves nothing for "until VRX closes", and the next open deletes rows that were already in the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vrx-activity-keep-'))
    dirs.push(dir)
    const path = join(dir, HISTORY_FILE_NAME)
    const first = open('session', path)
    first.history.append(entry(1, NOW))
    expect(first.database.maxActivityId()).toBe(0)
    first.database.insertActivity(stored(2, NOW))
    first.database.saveFriends(ACCOUNT, [
      {
        platformUserId: 'usr_a',
        displayName: 'Alice',
        since: NOW,
        sinceKnown: true,
        misses: 0
      }
    ])
    first.database.close()

    const reopened = open('session', path)
    expect(reopened.database.recentActivity(ACCOUNT, 10).map((entry) => entry.id)).toEqual([2])
    reopened.history.prune()
    reopened.friends.prune()
    expect(reopened.database.recentActivity(ACCOUNT, 10)).toEqual([])
    expect(reopened.database.savedFriends(ACCOUNT)).toEqual([])
    expect(
      reopened.history.page({ scope: [{ platform: 'vrchat', beforeId: null }], filter: 'all' }, 10)
    ).toBeNull()
    reopened.database.close()
  })
})
