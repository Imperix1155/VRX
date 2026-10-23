import { WebSocket } from 'ws'
import { API_TIMEOUT_MS } from '@shared/constants'
import { VRC_USER_AGENT } from './services/adapters/VrcApiClient'

/** Largest single message either live socket accepts. */
export const SOCKET_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024

/**
 * TCP keepalive idle time. The operating system then probes a quiet
 * connection and closes it when the peer is gone (after a network change),
 * so the reconnect loop runs. Probes are TCP-level and reach no API.
 */
export const SOCKET_KEEPALIVE_DELAY_MS = 30_000

function keepConnectionAlive(socket: WebSocket): WebSocket {
  socket.once('upgrade', (response) => {
    try {
      response.socket?.setKeepAlive(true, SOCKET_KEEPALIVE_DELAY_MS)
    } catch {
      /* keepalive is best effort; the connection works without it */
    }
  })
  return socket
}

function observeRejectedUpgrade(socket: WebSocket): WebSocket {
  socket.once('unexpected-response', (_request, response) => {
    const header = response.headers['retry-after']
    const retryAfter = typeof header === 'string' && header.length <= 128 ? header : null
    response.resume()
    try {
      // Only these two values cross the factory boundary. Never forward the
      // request, response body, credentials or other upgrade headers.
      socket.emit('upgrade-rejected', { statusCode: response.statusCode ?? 0, retryAfter })
    } finally {
      // Handling unexpected-response replaces ws's default abort path.
      // terminate() while CONNECTING aborts its request and emits error/close.
      socket.terminate()
      response.destroy()
    }
  })
  return socket
}

/** Production VRChat socket: bounded upgrade plus the API-identifying header. */
export function createVrcSocket(url: string): WebSocket {
  return keepConnectionAlive(
    observeRejectedUpgrade(
      new WebSocket(url, {
        headers: { 'User-Agent': VRC_USER_AGENT },
        handshakeTimeout: API_TIMEOUT_MS,
        maxPayload: SOCKET_MAX_PAYLOAD_BYTES
      })
    )
  )
}

/** Production CVR socket: preserve credential headers and bound the upgrade. */
export function createCvrSocket(url: string, headers: Record<string, string>): WebSocket {
  return keepConnectionAlive(
    observeRejectedUpgrade(
      new WebSocket(url, {
        headers,
        handshakeTimeout: API_TIMEOUT_MS,
        maxPayload: SOCKET_MAX_PAYLOAD_BYTES
      })
    )
  )
}
