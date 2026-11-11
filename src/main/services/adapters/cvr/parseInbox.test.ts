import { describe, expect, it } from 'vitest'
import { parseCvrInboxFrame } from './parseInbox'

const USER = '0f8fad5b-d9cb-469f-a165-70867728950e'
const WORLD = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const INSTANCE = 'i+0123456789abcdef-012345-abcdef-01234567'

const invite = (extra: Record<string, unknown>): Record<string, unknown> => ({
  Id: 'inv-1',
  User: { Id: USER, Name: 'Alice' },
  ...extra
})

describe('parseCvrInboxFrame: where an invite leads', () => {
  it('reads the instance and the world in either casing', () => {
    expect(
      parseCvrInboxFrame('invite', [
        invite({ World: { Id: WORLD, Name: 'Pug Lounge' }, InstanceId: INSTANCE })
      ]).entries[0]?.location
    ).toEqual({ worldId: WORLD, instanceId: INSTANCE })
    expect(
      parseCvrInboxFrame('invite', [
        { id: 'inv-1', user: { id: USER }, world: { id: WORLD }, instanceId: INSTANCE }
      ]).entries[0]?.location
    ).toEqual({ worldId: WORLD, instanceId: INSTANCE })
  })

  it('keeps the instance when the invite names no world, or a malformed one', () => {
    for (const world of [undefined, { Id: 'not-a-guid' }, { Id: 42 }, 'World']) {
      expect(
        parseCvrInboxFrame('invite', [invite({ World: world, InstanceId: INSTANCE })]).entries[0]
          ?.location
      ).toEqual({ worldId: '', instanceId: INSTANCE })
    }
  })

  it.each([undefined, 42, '', 'i+abc', WORLD, `${INSTANCE}&startInVR=true`, ` ${INSTANCE}`])(
    'keeps the row but no location for a malformed instance: %s',
    (instanceId) => {
      const { entries, skipped } = parseCvrInboxFrame('invite', [
        invite({ World: { Id: WORLD, Name: 'Pug Lounge' }, InstanceId: instanceId })
      ])
      expect(skipped).toBe(0)
      expect(entries[0]?.worldName).toBe('Pug Lounge')
      expect(entries[0]?.location).toBeNull()
    }
  )

  it('keeps no location for an invite request or a friend request', () => {
    const request = parseCvrInboxFrame('invite-request', [
      { Id: 'req-1', Sender: { Id: USER }, InstanceId: INSTANCE }
    ]).entries[0]
    expect(request).toBeDefined()
    expect(request?.location).toBeUndefined()
    const friend = parseCvrInboxFrame('friend-request', [{ Id: USER, InstanceId: INSTANCE }])
      .entries[0]
    expect(friend).toBeDefined()
    expect(friend?.location).toBeUndefined()
  })
})
