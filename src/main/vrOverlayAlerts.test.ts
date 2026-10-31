import { EventEmitter } from 'node:events'
import type { Socket } from 'node:dgram'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import type { InboxItem } from '@shared/inbox'
import {
  createVrOverlayAlerts,
  sendToXsOverlay,
  xsOverlayPayload,
  XSOVERLAY_HOST,
  XSOVERLAY_PORT,
  type VrOverlayAlerts
} from './vrOverlayAlerts'
import type { NativeAlert } from './friendNotifications'

const online: NativeAlert = {
  type: 'online',
  platform: 'chilloutvr',
  platformUserId: 'u1',
  displayName: 'Alice',
  worldName: null
}

const parse = (payload: Buffer): Record<string, unknown> =>
  JSON.parse(payload.toString('utf8')) as Record<string, unknown>

interface Harness {
  alerts: VrOverlayAlerts
  send: Mock<(payload: Buffer) => Promise<void>>
  logFailure: Mock<() => void>
}

function setup(patch: Partial<Settings> = {}, icon: string | null = 'aWNvbg=='): Harness {
  const settings = { ...DEFAULT_SETTINGS, vrOverlayAlerts: true, ...patch }
  const send = vi.fn<(payload: Buffer) => Promise<void>>(async () => undefined)
  const logFailure = vi.fn<() => void>()
  const alerts = createVrOverlayAlerts({
    getSettings: () => settings,
    iconBase64: () => icon,
    send,
    logFailure
  })
  return { alerts, send, logFailure }
}

describe('xsOverlayPayload', () => {
  it('builds the XSOverlay notification message VRCX also sends', () => {
    expect(parse(xsOverlayPayload('Friend Online', 'Alice came online', 5, 'aWNvbg=='))).toEqual({
      messageType: 1,
      index: 0,
      timeout: 5,
      height: 110,
      opacity: 1,
      volume: 0,
      audioPath: '',
      title: 'Friend Online',
      content: 'Alice came online',
      useBase64Icon: true,
      icon: 'aWNvbg==',
      sourceApp: 'VRX'
    })
  })

  it("falls back to XSOverlay's own icon and caps long text", () => {
    const message = parse(xsOverlayPayload('t'.repeat(200), 'c'.repeat(1_000), 3, null))
    expect(message.useBase64Icon).toBe(false)
    expect(message.icon).toBe('default')
    expect((message.title as string).length).toBe(80)
    expect((message.content as string).length).toBe(240)
    expect(message.height).toBe(150)
  })
})

describe('xsOverlayPayload text safety', () => {
  it('keeps names from restyling the alert and never cuts an emoji in half', () => {
    const message = parse(xsOverlayPayload('<b>Hi', `<color=red>Bob ${'😀'.repeat(300)}`, 5, null))
    expect(message.title).toBe('‹b>Hi')
    const content = message.content as string
    expect(content.startsWith('‹color=red>Bob ')).toBe(true)
    expect(Array.from(content)).toHaveLength(240)
    expect(content.endsWith('😀…')).toBe(true)
  })
})

describe('createVrOverlayAlerts', () => {
  it('sends nothing while VR alerts are off, which is the default', () => {
    expect(DEFAULT_SETTINGS.vrOverlayAlerts).toBe(false)
    const { alerts, send } = setup({ vrOverlayAlerts: false })
    alerts.notify(online)
    expect(send).not.toHaveBeenCalled()
  })

  it('uses the desktop alert words and the chosen time on screen', () => {
    const { alerts, send } = setup({ vrOverlayAlertDuration: 'long' })
    alerts.notify(online)
    const message = parse(send.mock.calls[0]![0])
    expect(message.title).toBe('Friend Online')
    expect(message.content).toBe('Alice came online')
    expect(message.timeout).toBe(8)
  })

  it('treats both platforms exactly the same', () => {
    const { alerts, send } = setup()
    alerts.notify(online)
    alerts.notify({ ...online, platform: 'vrchat' })
    expect(send.mock.calls[0]![0].equals(send.mock.calls[1]![0])).toBe(true)
  })

  it('shows inbox alerts too', () => {
    const { alerts, send } = setup({ vrOverlayAlertDuration: 'short' })
    const item = {
      kind: 'friend-request',
      platform: 'vrchat',
      senderName: 'Bob'
    } as unknown as InboxItem
    alerts.notify({ type: 'inbox', item })
    const message = parse(send.mock.calls[0]![0])
    expect(message.title).toBe('Friend Request')
    expect(message.timeout).toBe(3)
  })

  it('logs a failed send without the alert or the error', async () => {
    const { alerts, send, logFailure } = setup()
    send.mockRejectedValueOnce(new Error('Alice'))
    alerts.notify(online)
    await vi.waitFor(() => expect(logFailure).toHaveBeenCalledOnce())
    expect(logFailure).toHaveBeenCalledWith()
  })

  it('keeps going without an icon when the icon cannot be made', () => {
    const settings = { ...DEFAULT_SETTINGS, vrOverlayAlerts: true }
    const send = vi.fn<(payload: Buffer) => Promise<void>>(async () => undefined)
    createVrOverlayAlerts({
      getSettings: () => settings,
      iconBase64: () => {
        throw new Error('no icon')
      },
      send,
      logFailure: vi.fn()
    }).notify(online)
    expect(parse(send.mock.calls[0]![0]).icon).toBe('default')
  })

  it('sends a test alert even while the switch is off', async () => {
    const { alerts, send } = setup({ vrOverlayAlerts: false })
    await alerts.test()
    expect(parse(send.mock.calls[0]![0]).title).toBe('VRX')
  })
})

class FakeSocket extends EventEmitter {
  bound: unknown
  sent: { payload: Buffer; port: number; host: string } | null = null
  closed = 0
  sendError: Error | null = null
  bind(options: unknown, callback: () => void): void {
    this.bound = options
    callback()
  }
  unref(): this {
    return this
  }
  send(payload: Buffer, port: number, host: string, callback: (error: Error | null) => void): void {
    this.sent = { payload, port, host }
    callback(this.sendError)
  }
  close(): void {
    this.closed += 1
  }
}

describe('sendToXsOverlay', () => {
  it('binds to loopback, sends one datagram to XSOverlay on this computer, and closes', async () => {
    const socket = new FakeSocket()
    await sendToXsOverlay(Buffer.from('x'), () => socket as unknown as Socket)
    expect(socket.bound).toEqual({ address: '127.0.0.1', port: 0 })
    expect(socket.sent).toEqual({ payload: Buffer.from('x'), port: 42069, host: '127.0.0.1' })
    expect(XSOVERLAY_HOST).toBe('127.0.0.1')
    expect(XSOVERLAY_PORT).toBe(42069)
    expect(socket.closed).toBe(1)
  })

  it('rejects and closes when the send fails', async () => {
    const socket = new FakeSocket()
    socket.sendError = new Error('send failed')
    await expect(
      sendToXsOverlay(Buffer.from('x'), () => socket as unknown as Socket)
    ).rejects.toThrow()
    expect(socket.closed).toBe(1)
  })

  it('rejects once on a socket error', async () => {
    const socket = new FakeSocket()
    socket.bind = () => {
      socket.emit('error', new Error('bind failed'))
    }
    await expect(
      sendToXsOverlay(Buffer.from('x'), () => socket as unknown as Socket)
    ).rejects.toThrow()
    expect(socket.closed).toBe(1)
  })
})
