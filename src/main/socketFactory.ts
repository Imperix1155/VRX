import { WebSocket } from 'ws'
import { API_TIMEOUT_MS } from '@shared/constants'
import { VRC_USER_AGENT } from './services/adapters/VrcApiClient'

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
  return observeRejectedUpgrade(
    new WebSocket(url, {
      headers: { 'User-Agent': VRC_USER_AGENT },
      handshakeTimeout: API_TIMEOUT_MS
    })
  )
}

/** Production CVR socket: preserve credential headers and bound the upgrade. */
export function createCvrSocket(url: string, headers: Record<string, string>): WebSocket {
  return observeRejectedUpgrade(new WebSocket(url, { headers, handshakeTimeout: API_TIMEOUT_MS }))
}
