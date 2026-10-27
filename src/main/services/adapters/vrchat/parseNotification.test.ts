import { describe, expect, it } from 'vitest'
import { INBOX_NAME_MAX_LENGTH } from '@shared/inbox'
import { notificationIdOf, parseVrcNotification } from './parseNotification'

describe('parseVrcNotification', () => {
  it('reads the world name from object or string details', () => {
    const base = { id: 'not_1', type: 'invite', senderUserId: 'usr_a', senderUsername: 'Alice' }
    expect(parseVrcNotification({ ...base, details: { worldName: 'Pug' } })?.worldName).toBe('Pug')
    expect(parseVrcNotification({ ...base, details: '{"worldName":"Pug"}' })?.worldName).toBe('Pug')
    expect(parseVrcNotification({ ...base, details: '{broken' })?.worldName).toBeNull()
    expect(parseVrcNotification({ ...base, details: { worldName: 42 } })?.worldName).toBeNull()
  })

  it('names no world for friend requests and invite requests', () => {
    expect(
      parseVrcNotification({
        id: 'not_1',
        type: 'friendRequest',
        senderUserId: 'usr_a',
        details: { worldName: 'Should not show' }
      })?.worldName
    ).toBeNull()
  })

  it('rejects unrelated types, unsafe IDs and prototype keys', () => {
    expect(parseVrcNotification({ id: 'not_1', type: 'message', senderUserId: 'usr_a' })).toBeNull()
    expect(
      parseVrcNotification({ id: 'not_1', type: 'toString', senderUserId: 'usr_a' })
    ).toBeNull()
    expect(parseVrcNotification({ id: 'not 1', type: 'invite', senderUserId: 'usr_a' })).toBeNull()
    expect(
      parseVrcNotification({ id: 'not_1', type: 'invite', senderUserId: 'x'.repeat(200) })
    ).toBeNull()
    expect(parseVrcNotification(null)).toBeNull()
    expect(parseVrcNotification('not_1')).toBeNull()
  })

  it('bounds the sender name and drops a blank one', () => {
    const long = parseVrcNotification({
      id: 'not_1',
      type: 'friendRequest',
      senderUserId: 'usr_a',
      senderUsername: 'n'.repeat(500)
    })
    expect(long?.senderName).toHaveLength(INBOX_NAME_MAX_LENGTH)
    expect(
      parseVrcNotification({
        id: 'not_1',
        type: 'friendRequest',
        senderUserId: 'usr_a',
        senderUsername: '   '
      })?.senderName
    ).toBeNull()
  })
})

describe('notificationIdOf', () => {
  it('reads a bare ID or a response notificationId', () => {
    expect(notificationIdOf('not_1')).toBe('not_1')
    expect(notificationIdOf({ notificationId: 'not_2', responseId: 'not_3' })).toBe('not_2')
    expect(notificationIdOf({ id: 'not_2' })).toBeNull()
    expect(notificationIdOf('')).toBeNull()
    expect(notificationIdOf(7)).toBeNull()
  })
})
