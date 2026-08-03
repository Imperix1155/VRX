import { WebSocket } from 'ws'
import { API_TIMEOUT_MS } from '@shared/constants'
import { VRC_USER_AGENT } from './services/adapters/VrcApiClient'

/** Production VRChat socket: bounded upgrade plus the API-identifying header. */
export function createVrcSocket(url: string): WebSocket {
  return new WebSocket(url, {
    headers: { 'User-Agent': VRC_USER_AGENT },
    handshakeTimeout: API_TIMEOUT_MS
  })
}

/** Production CVR socket: preserve credential headers and bound the upgrade. */
export function createCvrSocket(url: string, headers: Record<string, string>): WebSocket {
  return new WebSocket(url, { headers, handshakeTimeout: API_TIMEOUT_MS })
}
