import { describe, expect, it, vi } from 'vitest'
import type { AdapterEvent, InstanceInfo } from '@shared/types'
import { CvrInstanceWatch } from './cvrInstanceWatch'

const ME = 'aaaaaaaa-0000-4000-8000-000000000001'
const PAL = 'aaaaaaaa-0000-4000-8000-000000000002'
const STRANGER = 'aaaaaaaa-0000-4000-8000-000000000003'

function instance(instanceId: string, worldName: string | null = null): InstanceInfo {
  return {
    // Unresolved: the world id is the instance id and the name is a label.
    worldId: worldName === null ? instanceId : `world-of-${instanceId}`,
    instanceId,
    worldName: worldName ?? 'Label (#123)',
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

function snapshot(entries: Array<[string, InstanceInfo | null]>): AdapterEvent {
  return {
    type: 'presence-snapshot',
    platform: 'chilloutvr',
    entries: entries.map(([platformUserId, where]) => ({
      platformUserId,
      presence: { state: 'in-game' },
      instance: where
    }))
  }
}

function setup(): {
  watch: CvrInstanceWatch
  sink: Record<'enter' | 'nameWorld' | 'join' | 'leave' | 'exit', ReturnType<typeof vi.fn>>
  members: Map<string, Array<{ platformUserId: string; displayName: string }>>
  setNow: (value: number) => void
  setOwnId: (value: string | null) => void
  setEnabled: (value: boolean) => void
} {
  let now = 1_000
  let ownId: string | null = ME.toUpperCase()
  let enabled = true
  const members = new Map<string, Array<{ platformUserId: string; displayName: string }>>()
  const sink = {
    enter: vi.fn(),
    nameWorld: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    exit: vi.fn()
  }
  const watch = new CvrInstanceWatch({
    isEnabled: () => enabled,
    ownId: () => ownId,
    members: (instanceId) => members.get(instanceId) ?? null,
    nameOf: (id) => (id === PAL ? 'Pal' : null),
    sink,
    now: () => now
  })
  return {
    watch,
    sink,
    members,
    setNow: (value) => {
      now = value
    },
    setOwnId: (value) => {
      ownId = value
    },
    setEnabled: (value) => {
      enabled = value
    }
  }
}

describe('CvrInstanceWatch', () => {
  it('does nothing while the platform does not list the signed-in user', () => {
    const { watch, sink } = setup()
    watch.consume(snapshot([[PAL, instance('i-1')]]))
    expect(sink.enter).not.toHaveBeenCalled()
    expect(sink.exit).not.toHaveBeenCalled()
  })

  it('opens a visit for the room the user is in and names the world once it is known', () => {
    const { watch, sink, setNow } = setup()
    watch.consume(snapshot([[ME, instance('i-1')]]))
    expect(sink.enter).toHaveBeenCalledWith('chilloutvr', {
      instanceId: 'i-1',
      worldName: null,
      at: 1_000
    })
    setNow(2_000)
    watch.consume(snapshot([[ME, instance('i-1', 'Midnight Museum')]]))
    watch.consume(snapshot([[ME, instance('i-1', 'Midnight Museum')]]))
    expect(sink.enter).toHaveBeenCalledTimes(1)
    expect(sink.nameWorld).toHaveBeenCalledExactlyOnceWith('chilloutvr', 'Midnight Museum')
  })

  it('records friends in the same room as they come and go', () => {
    const { watch, sink, setNow } = setup()
    watch.consume(snapshot([[ME, instance('i-1')]]))
    setNow(2_000)
    watch.consume(
      snapshot([
        [ME, instance('i-1')],
        [PAL, instance('i-1')],
        [STRANGER, instance('i-2')]
      ])
    )
    expect(sink.join).toHaveBeenCalledExactlyOnceWith('chilloutvr', {
      platformUserId: PAL,
      displayName: 'Pal',
      at: 2_000
    })
    setNow(3_000)
    watch.consume(
      snapshot([
        [ME, instance('i-1')],
        [PAL, instance('i-2')]
      ])
    )
    expect(sink.leave).toHaveBeenCalledExactlyOnceWith('chilloutvr', PAL, 3_000)
  })

  it('takes the member list once, from the user’s arrival, and never names the user', () => {
    const { watch, sink, members, setNow } = setup()
    watch.consume(
      snapshot([
        [ME, instance('i-1')],
        [PAL, instance('i-1')]
      ])
    )
    setNow(4_000)
    members.set('i-1', [
      { platformUserId: ME, displayName: 'Me' },
      { platformUserId: PAL, displayName: 'Pal' },
      { platformUserId: STRANGER, displayName: 'Stranger' }
    ])
    watch.consume(
      snapshot([
        [ME, instance('i-1', 'Midnight Museum')],
        [PAL, instance('i-1')]
      ])
    )
    watch.consume(
      snapshot([
        [ME, instance('i-1', 'Midnight Museum')],
        [PAL, instance('i-1')]
      ])
    )

    expect(sink.join.mock.calls.map((call) => call[1] as unknown)).toEqual([
      { platformUserId: PAL, displayName: 'Pal', at: 1_000 },
      { platformUserId: STRANGER, displayName: 'Stranger', at: 1_000 }
    ])
  })

  it('waits for a friend’s name rather than saving a blank', () => {
    const { watch, sink } = setup()
    watch.consume(
      snapshot([
        [ME, instance('i-1')],
        [STRANGER, instance('i-1')]
      ])
    )
    expect(sink.join).not.toHaveBeenCalled()
  })

  it('ends the visit when the user changes room, goes offline, or the account changes', () => {
    const { watch, sink, setNow, setOwnId } = setup()
    watch.consume(snapshot([[ME, instance('i-1')]]))
    setNow(2_000)
    watch.consume(snapshot([[ME, instance('i-2')]]))
    // The instance log ends the earlier room itself when a new one begins.
    expect(sink.enter).toHaveBeenLastCalledWith('chilloutvr', {
      instanceId: 'i-2',
      worldName: null,
      at: 2_000
    })
    setNow(3_000)
    watch.consume(snapshot([[PAL, instance('i-2')]]))
    expect(sink.exit).toHaveBeenCalledExactlyOnceWith('chilloutvr', 3_000)

    watch.consume(snapshot([[ME, instance('i-3')]]))
    watch.resetPlatform()
    setOwnId(null)
    watch.consume(snapshot([[ME, instance('i-3')]]))
    expect(sink.enter).toHaveBeenCalledTimes(3)
  })

  it('opens the room anew once the instance log is kept again', () => {
    const { watch, sink, setEnabled } = setup()
    setEnabled(false)
    watch.consume(snapshot([[ME, instance('i-1')]]))
    expect(sink.enter).not.toHaveBeenCalled()
    setEnabled(true)
    watch.consume(snapshot([[ME, instance('i-1')]]))
    expect(sink.enter).toHaveBeenCalledTimes(1)
  })

  it('ignores other platforms and other events', () => {
    const { watch, sink } = setup()
    watch.consume({ type: 'connection', platform: 'chilloutvr', health: 'live' })
    watch.consume({ ...snapshot([[ME, instance('i-1')]]), platform: 'vrchat' })
    expect(sink.enter).not.toHaveBeenCalled()
  })
})
