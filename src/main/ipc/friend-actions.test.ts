import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { FriendActionsService } from '../services/friendActions'

const { handlers, trusted } = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, request: unknown) => unknown>(),
  trusted: { value: true }
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: IpcMainInvokeEvent, request: unknown) => unknown) =>
      handlers.set(channel, handler)
  }
}))
vi.mock('./security', () => ({ isTrustedIpcSender: () => trusted.value }))
import { registerFriendActionHandlers } from './friend-actions'

const event = { senderFrame: {} } as IpcMainInvokeEvent
const service = {
  answer: vi.fn(() => Promise.resolve({ ok: true })),
  send: vi.fn(() => Promise.resolve({ ok: true }))
}
const call = (channel: string, req: unknown): unknown => handlers.get(channel)!(event, req)
const ROW = 'friend-request:not_5a3c1e2d-0000-4000-8000-000000000001'
const USER = 'usr_5a3c1e2d-0000-4000-8000-000000000001'

beforeEach(() => {
  handlers.clear()
  trusted.value = true
  vi.clearAllMocks()
  registerFriendActionHandlers(service as unknown as FriendActionsService)
})

describe('Friend action IPC boundary', () => {
  it.each([
    ['answer-friend-request', { platform: 'vrchat', id: ROW, answer: 'accept' }],
    ['send-friend-request', { platform: 'vrchat', userId: USER }]
  ])('guards %s before parsing or delegating', (channel, req) => {
    trusted.value = false
    expect(() => call(channel, req)).toThrow('Untrusted IPC sender')
    expect(service.answer).not.toHaveBeenCalled()
    expect(service.send).not.toHaveBeenCalled()
  })

  it('passes a well-formed answer to the service', async () => {
    await expect(
      call('answer-friend-request', { platform: 'chilloutvr', id: ROW, answer: 'decline' })
    ).resolves.toEqual({ ok: true })
    expect(service.answer).toHaveBeenCalledWith('chilloutvr', ROW, 'decline')
  })

  it('rejects other rows, answers, platforms and extra keys', () => {
    for (const req of [
      null,
      {},
      { platform: 'steam', id: ROW, answer: 'accept' },
      { platform: 'vrchat', id: 'invite:not_1', answer: 'accept' },
      { platform: 'vrchat', id: 'friend-request:../x', answer: 'accept' },
      { platform: 'vrchat', id: `friend-request:${'a'.repeat(160)}`, answer: 'accept' },
      { platform: 'vrchat', id: ROW, answer: 'block' },
      { platform: 'vrchat', id: ROW, answer: 'accept', senderId: USER }
    ]) {
      expect(() => call('answer-friend-request', req)).toThrow()
    }
    expect(service.answer).not.toHaveBeenCalled()
  })

  it('passes a well-formed send to the service and rejects the rest', async () => {
    await expect(
      call('send-friend-request', { platform: 'vrchat', userId: USER })
    ).resolves.toEqual({ ok: true })
    expect(service.send).toHaveBeenCalledWith('vrchat', USER)
    for (const req of [
      { platform: 'vrchat' },
      { platform: 'vrchat', userId: '' },
      { platform: 'vrchat', userId: 'x'.repeat(65) },
      { platform: 'vrchat', userId: 42 },
      { platform: 'vrchat', userId: USER, message: 'hi' }
    ]) {
      expect(() => call('send-friend-request', req)).toThrow()
    }
    expect(service.send).toHaveBeenCalledTimes(1)
  })
})
