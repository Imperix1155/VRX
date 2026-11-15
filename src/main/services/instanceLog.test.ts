import { describe, expect, it, vi } from 'vitest'
import type { Platform } from '@shared/types'
import { HistoryDatabase } from './historyDatabase'
import { InstanceLog } from './instanceLog'

const VRC = 'vrchat:usr_me'

interface World {
  database: HistoryDatabase
  accounts: Partial<Record<Platform, string>>
  setSaving: (value: boolean) => void
  onChanged: ReturnType<typeof vi.fn>
  /** VRX's clock, for the moment the log is cleared. */
  setNow: (value: number) => void
  /** A log over the same saved copy, as a restart would build. */
  log: () => InstanceLog
}

function setup(): World {
  let saving = true
  let now = 0
  const accounts: Partial<Record<Platform, string>> = {
    vrchat: VRC,
    chilloutvr: 'chilloutvr:me-1'
  }
  const database = new HistoryDatabase({ path: null })
  const onChanged = vi.fn()
  return {
    database,
    accounts,
    onChanged,
    setSaving: (value) => {
      saving = value
    },
    setNow: (value) => {
      now = value
    },
    log: () =>
      new InstanceLog({
        database,
        accountKeyFor: (platform) => accounts[platform] ?? null,
        isSaving: () => saving,
        onChanged,
        now: () => now
      })
  }
}

const all = { scope: [{ platform: 'vrchat' as const, before: null }] }

describe('InstanceLog', () => {
  it('saves a visit with who was there and when they left', () => {
    const world = setup()
    const log = world.log()
    log.enter('vrchat', { instanceId: 'wrld_a:1', worldName: 'Pug Lounge', at: 1_000 })
    log.join('vrchat', { platformUserId: 'usr_a', displayName: 'Alice', at: 1_000 })
    log.join('vrchat', { platformUserId: 'usr_b', displayName: 'Bob', at: 2_000 })
    log.leave('vrchat', 'usr_a', 5_000)

    expect(log.page(all)).toEqual({
      visits: [
        {
          id: expect.any(Number) as number,
          platform: 'vrchat',
          worldName: 'Pug Lounge',
          enteredAt: 1_000,
          leftAt: null,
          current: true,
          people: 2
        }
      ],
      hasMore: false
    })
    const visitId = log.page(all).visits[0]!.id
    expect(log.people('vrchat', visitId)).toEqual([
      { platformUserId: 'usr_a', displayName: 'Alice', joinedAt: 1_000, leftAt: 5_000 },
      { platformUserId: 'usr_b', displayName: 'Bob', joinedAt: 2_000, leftAt: null }
    ])

    log.exit('vrchat', 9_000)
    expect(log.page(all).visits[0]).toMatchObject({ leftAt: 9_000, current: false })
    expect(log.people('vrchat', visitId)[1]).toMatchObject({ leftAt: 9_000 })
    expect(world.onChanged).toHaveBeenCalled()
  })

  it('never counts the signed-in user as someone they met', () => {
    const world = setup()
    const log = world.log()
    log.enter('vrchat', { instanceId: 'wrld_a:1', worldName: null, at: 1_000 })
    log.join('vrchat', { platformUserId: 'USR_ME', displayName: 'Me', at: 1_000 })
    expect(log.page(all).visits[0]).toMatchObject({ people: 0, worldName: null })
  })

  it('saves nothing twice when the same steps are told again', () => {
    const world = setup()
    const replay = (log: InstanceLog): void => {
      log.batch(() => {
        log.enter('vrchat', { instanceId: 'wrld_a:1', worldName: 'Pug Lounge', at: 1_000 })
        log.join('vrchat', { platformUserId: 'usr_a', displayName: 'Alice', at: 1_500 })
        log.leave('vrchat', 'usr_a', 2_000)
        log.join('vrchat', { platformUserId: 'usr_a', displayName: 'Alice', at: 3_000 })
        log.exit('vrchat', 4_000)
        log.enter('vrchat', { instanceId: 'wrld_b:2', worldName: 'Night Market', at: 5_000 })
        log.join('vrchat', { platformUserId: 'usr_a', displayName: 'Alice', at: 5_500 })
      })
    }
    replay(world.log())
    const restarted = world.log()
    replay(restarted)

    const { visits } = restarted.page(all)
    expect(visits.map((visit) => [visit.worldName, visit.leftAt, visit.current])).toEqual([
      ['Night Market', null, true],
      ['Pug Lounge', 4_000, false]
    ])
    expect(restarted.met('vrchat', 'usr_a')).toEqual({
      times: 2,
      // 500 ms, then 1,000 ms; the stay still open adds nothing yet.
      togetherMs: 1_500,
      lastAt: 5_500,
      lastWorldName: 'Night Market'
    })
    expect(restarted.met('vrchat', 'usr_nobody')).toBeNull()
  })

  it('ends an earlier visit whose end was never seen, at the last moment seen in it', () => {
    const world = setup()
    const first = world.log()
    first.enter('vrchat', { instanceId: 'wrld_a:1', worldName: 'Pug Lounge', at: 1_000 })
    first.join('vrchat', { platformUserId: 'usr_a', displayName: 'Alice', at: 3_000 })
    // The game closed without saying so; VRX restarts and a new room begins.
    const second = world.log()
    second.enter('vrchat', { instanceId: 'wrld_b:2', worldName: 'Night Market', at: 50_000 })

    expect(second.page(all).visits.map((visit) => visit.leftAt)).toEqual([null, 3_000])
  })

  it('fills in a world name that arrives late, and keeps the first one', () => {
    const world = setup()
    const log = world.log()
    log.enter('chilloutvr', { instanceId: 'i-1', worldName: null, at: 1_000 })
    log.nameWorld('chilloutvr', 'Midnight Museum')
    log.nameWorld('chilloutvr', 'Something else')
    expect(
      log.page({ scope: [{ platform: 'chilloutvr', before: null }] }).visits[0]?.worldName
    ).toBe('Midnight Museum')
  })

  it('keeps each account to its own log and pages each from its own place', () => {
    const world = setup()
    const log = world.log()
    for (let n = 1; n <= 3; n++) {
      log.enter('vrchat', { instanceId: `wrld_a:${n}`, worldName: `V${n}`, at: n * 1_000 })
      log.enter('chilloutvr', { instanceId: `i-${n}`, worldName: `C${n}`, at: n * 1_000 + 500 })
    }
    const both = {
      scope: [
        { platform: 'vrchat' as const, before: 3_000 },
        { platform: 'chilloutvr' as const, before: 2_500 }
      ]
    }
    expect(log.page(both).visits.map((visit) => visit.worldName)).toEqual(['V2', 'C1', 'V1'])

    // Another VRChat account sees none of it, and cannot read its people.
    const visitId = log.page(all).visits[0]!.id
    log.join('vrchat', { platformUserId: 'usr_a', displayName: 'Alice', at: 3_100 })
    world.accounts.vrchat = 'vrchat:usr_other'
    expect(log.page(all).visits).toEqual([])
    expect(log.people('vrchat', visitId)).toEqual([])
    expect(log.met('vrchat', 'usr_a')).toBeNull()
    // And nothing more is added to the first account's visit.
    log.join('vrchat', { platformUserId: 'usr_b', displayName: 'Bob', at: 3_200 })
    world.accounts.vrchat = VRC
    expect(log.people('vrchat', visitId).map((person) => person.platformUserId)).toEqual(['usr_a'])
  })

  it('ends the room at an account boundary', () => {
    const world = setup()
    const log = world.log()
    log.enter('vrchat', { instanceId: 'wrld_a:1', worldName: 'Pug Lounge', at: 1_000 })
    log.join('vrchat', { platformUserId: 'usr_a', displayName: 'Alice', at: 2_000 })
    log.resetPlatform('vrchat')
    expect(log.page(all).visits[0]).toMatchObject({ leftAt: 2_000, current: false })
    expect(log.currentInstanceId('vrchat')).toBeNull()
  })

  it('saves nothing while saving is off', () => {
    const world = setup()
    const log = world.log()
    world.setSaving(false)
    log.enter('vrchat', { instanceId: 'wrld_a:1', worldName: 'Pug Lounge', at: 1_000 })
    log.join('vrchat', { platformUserId: 'usr_a', displayName: 'Alice', at: 2_000 })
    world.setSaving(true)
    expect(log.page(all).visits).toEqual([])
  })

  it('clears one platform, or everything', () => {
    const world = setup()
    const log = world.log()
    log.enter('vrchat', { instanceId: 'wrld_a:1', worldName: 'Pug Lounge', at: 1_000 })
    log.join('vrchat', { platformUserId: 'usr_a', displayName: 'Alice', at: 2_000 })
    log.enter('chilloutvr', { instanceId: 'i-1', worldName: 'Museum', at: 1_000 })
    const cvr = { scope: [{ platform: 'chilloutvr' as const, before: null }] }

    log.clear(['vrchat'])
    expect(log.page(all).visits).toEqual([])
    expect(log.met('vrchat', 'usr_a')).toBeNull()
    expect(log.page(cvr).visits).toHaveLength(1)
    log.clearAll()
    expect(log.page(cvr).visits).toEqual([])
  })

  it('keeps a cleared log cleared when a source tells the same rooms again', () => {
    const world = setup()
    const replay = (log: InstanceLog): void => {
      log.enter('vrchat', { instanceId: 'wrld_a:1', worldName: 'Pug Lounge', at: 1_000 })
      log.join('vrchat', { platformUserId: 'usr_a', displayName: 'Alice', at: 2_000 })
      log.enter('vrchat', { instanceId: 'wrld_b:2', worldName: 'Still here', at: 4_000 })
      log.join('vrchat', { platformUserId: 'usr_a', displayName: 'Alice', at: 4_500 })
    }
    const cvr = { scope: [{ platform: 'chilloutvr' as const, before: null }] }
    const log = world.log()
    replay(log)
    log.enter('chilloutvr', { instanceId: 'i-1', worldName: 'Museum', at: 1_000 })
    world.setNow(5_000)
    log.clear(['vrchat'])

    // A restart reads the game's log from its first line.
    const restarted = world.log()
    replay(restarted)
    // Someone arriving after the clear, in the room entered before it.
    restarted.join('vrchat', { platformUserId: 'usr_b', displayName: 'Bob', at: 6_000 })
    expect(restarted.page(all).visits).toEqual([])
    expect(restarted.met('vrchat', 'usr_a')).toBeNull()
    // The other platform was not cleared, and what follows is saved as ever.
    restarted.enter('chilloutvr', { instanceId: 'i-1', worldName: 'Museum', at: 1_000 })
    expect(restarted.page(cvr).visits).toHaveLength(1)
    restarted.enter('vrchat', { instanceId: 'wrld_c:3', worldName: 'After', at: 7_000 })
    expect(restarted.page(all).visits.map((visit) => visit.worldName)).toEqual(['After'])

    world.setNow(8_000)
    restarted.clearAll()
    const again = world.log()
    replay(again)
    again.enter('vrchat', { instanceId: 'wrld_c:3', worldName: 'After', at: 7_000 })
    again.enter('chilloutvr', { instanceId: 'i-1', worldName: 'Museum', at: 1_000 })
    expect(again.page(all).visits).toEqual([])
    expect(again.page(cvr).visits).toEqual([])
  })

  it('removes ended visits past the age limit and keeps the one in progress', () => {
    const world = setup()
    const log = world.log()
    log.enter('vrchat', { instanceId: 'wrld_a:1', worldName: 'Old', at: 1_000 })
    log.join('vrchat', { platformUserId: 'usr_a', displayName: 'Alice', at: 1_500 })
    log.enter('vrchat', { instanceId: 'wrld_b:2', worldName: 'Newer', at: 5_000 })
    log.enter('vrchat', { instanceId: 'wrld_c:3', worldName: 'Now', at: 9_000 })

    world.database.pruneInstanceLog(6_000, 1_000)
    expect(log.page(all).visits.map((visit) => visit.worldName)).toEqual(['Now'])
    expect(log.met('vrchat', 'usr_a')).toBeNull()

    log.enter('vrchat', { instanceId: 'wrld_d:4', worldName: 'Next', at: 12_000 })
    log.enter('vrchat', { instanceId: 'wrld_e:5', worldName: 'Last', at: 15_000 })
    world.database.pruneInstanceLog(null, 2)
    expect(log.page(all).visits.map((visit) => visit.worldName)).toEqual(['Last', 'Next'])
  })
})
