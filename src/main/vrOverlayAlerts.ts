import { createSocket, type Socket } from 'node:dgram'
import type { Settings } from '@shared/settings'
import type { VrAlertDuration } from '@shared/types'
import { notificationPresenter, type NativeAlert } from './friendNotifications'
import { mt } from './i18n'

/**
 * Alerts in the VR headset through XSOverlay, the overlay VRCX and CVRX both
 * send to. VRX speaks XSOverlay's UDP notification API on this computer only:
 * one datagram from a socket bound to loopback, to the loopback port XSOverlay
 * listens on, then the socket closes. Nothing listens, nothing leaves the
 * machine, and nothing waits for or reads an answer.
 */
export const XSOVERLAY_HOST = '127.0.0.1'
export const XSOVERLAY_PORT = 42069

export const VR_ALERT_SECONDS: Record<VrAlertDuration, number> = {
  short: 3,
  medium: 5,
  long: 8
}

// Display names and world names are bounded upstream; these caps keep one
// datagram small even if that ever changes.
const MAX_TITLE_LENGTH = 80
const MAX_CONTENT_LENGTH = 240

export type DatagramSend = (payload: Buffer) => Promise<void>

export interface VrOverlayAlertOptions {
  getSettings: () => Settings
  /** The VRX icon as base64 PNG, or null to use XSOverlay's own. */
  iconBase64: () => string | null
  send?: DatagramSend
  logFailure: () => void
}

export interface VrOverlayAlerts {
  /** Show an alert that already passed its own switch, when VR alerts are on. */
  notify: (alert: NativeAlert) => void
  /** The Settings test button: one alert now, whatever the switch says. */
  test: () => Promise<void>
}

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`

/** XSOverlay's notification message (messageType 1), the same fields VRCX sends. */
export function xsOverlayPayload(
  title: string,
  content: string,
  seconds: number,
  icon: string | null
): Buffer {
  const body = clip(content, MAX_CONTENT_LENGTH)
  return Buffer.from(
    JSON.stringify({
      messageType: 1,
      index: 0,
      timeout: seconds,
      height: body.length > 100 ? 150 : 110,
      opacity: 1,
      volume: 0,
      audioPath: '',
      title: clip(title, MAX_TITLE_LENGTH),
      content: body,
      useBase64Icon: icon !== null,
      icon: icon ?? 'default',
      sourceApp: 'VRX'
    }),
    'utf8'
  )
}

/** Send one datagram to XSOverlay and close. Rejects without detail text worth logging. */
export function sendToXsOverlay(
  payload: Buffer,
  socketFactory: () => Socket = () => createSocket('udp4')
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = socketFactory()
    let settled = false
    const finish = (error?: Error | null): void => {
      if (settled) return
      settled = true
      try {
        socket.close()
      } catch {
        // Already closed after an error.
      }
      if (error) reject(error)
      else resolve()
    }
    // A dgram socket without an error listener would throw from the event loop.
    socket.on('error', (error) => finish(error))
    try {
      socket.bind({ address: XSOVERLAY_HOST, port: 0 }, () => {
        socket.unref()
        socket.send(payload, XSOVERLAY_PORT, XSOVERLAY_HOST, (error) => finish(error))
      })
    } catch (error) {
      finish(error instanceof Error ? error : new Error('bind failed'))
    }
  })
}

export function createVrOverlayAlerts({
  getSettings,
  iconBase64,
  send = (payload) => sendToXsOverlay(payload),
  logFailure
}: VrOverlayAlertOptions): VrOverlayAlerts {
  const deliver = (title: string, body: string): Promise<void> => {
    const seconds = VR_ALERT_SECONDS[getSettings().vrOverlayAlertDuration]
    let icon: string | null
    try {
      icon = iconBase64()
    } catch {
      icon = null
    }
    return send(xsOverlayPayload(title, body, seconds, icon))
  }

  return {
    notify: (alert): void => {
      if (!getSettings().vrOverlayAlerts) return
      try {
        // The same words as the desktop alert, so both say exactly the same
        // thing and keep the same privacy checks.
        const { title, body } = notificationPresenter(alert)
        // Never log the error or the alert: either may carry a friend's name.
        deliver(title, body).catch(() => logFailure())
      } catch {
        logFailure()
      }
    },
    test: () => deliver(mt('notify.vrTest.title'), mt('notify.vrTest.body'))
  }
}
