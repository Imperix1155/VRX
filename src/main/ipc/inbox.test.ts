import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { InboxService } from '../services/inbox'

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

import { registerInboxHandlers } from './inbox'

const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent
let inbox: {
  snapshot: ReturnType<typeof vi.fn>
  dismiss: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  handlers.clear()
  trusted.value = true
  inbox = {
    snapshot: vi.fn(() => ({ items: [] })),
    dismiss: vi.fn(() => true),
    clear: vi.fn()
  }
  registerInboxHandlers(inbox as unknown as InboxService)
})

describe('inbox handlers', () => {
  it('rejects untrusted senders on every channel before touching the inbox', () => {
    trusted.value = false
    expect(() => handlers.get('get-inbox')!(event)).toThrow('Untrusted IPC sender')
    expect(() =>
      handlers.get('dismiss-inbox-item')!(event, { platform: 'vrchat', id: 'invite:not_1' })
    ).toThrow('Untrusted IPC sender')
    expect(() => handlers.get('clear-inbox')!(event, { platforms: ['vrchat'] })).toThrow(
      'Untrusted IPC sender'
    )
    expect(inbox.snapshot).not.toHaveBeenCalled()
    expect(inbox.dismiss).not.toHaveBeenCalled()
    expect(inbox.clear).not.toHaveBeenCalled()
  })

  it('returns the snapshot and passes valid dismissals and clears through', () => {
    expect(handlers.get('get-inbox')!(event)).toEqual({ items: [] })
    handlers.get('dismiss-inbox-item')!(event, {
      platform: 'chilloutvr',
      id: 'friend-request:abc-1'
    })
    expect(inbox.dismiss).toHaveBeenCalledWith('chilloutvr', 'friend-request:abc-1')
    handlers.get('clear-inbox')!(event, { platforms: ['vrchat', 'chilloutvr'] })
    expect(inbox.clear).toHaveBeenCalledWith(['vrchat', 'chilloutvr'])
  })

  it.each([
    undefined,
    null,
    [],
    { platform: 'steam', id: 'invite:not_1' },
    { platform: 'vrchat' },
    { platform: 'vrchat', id: 'not_1' },
    { platform: 'vrchat', id: 'invite:' },
    { platform: 'vrchat', id: 'invite:a b' },
    { platform: 'vrchat', id: `invite:${'x'.repeat(200)}` },
    { platform: 'vrchat', id: 7 },
    Object.assign(Object.create({ polluted: true }) as object, {
      platform: 'vrchat',
      id: 'invite:not_1'
    })
  ])('refuses a malformed dismissal %#', (req) => {
    expect(() => handlers.get('dismiss-inbox-item')!(event, req)).toThrow(
      'Invalid dismiss-inbox-item request'
    )
    expect(inbox.dismiss).not.toHaveBeenCalled()
  })

  it.each([
    undefined,
    { platforms: [] },
    { platforms: 'vrchat' },
    { platforms: ['vrchat', 'steam'] },
    { platforms: ['vrchat', 'vrchat', 'vrchat'] }
  ])('refuses a malformed clear %#', (req) => {
    expect(() => handlers.get('clear-inbox')!(event, req)).toThrow('Invalid clear-inbox request')
    expect(inbox.clear).not.toHaveBeenCalled()
  })
})
