import { beforeEach, describe, expect, it, vi } from 'vitest'
import { API_TIMEOUT_MS } from '@shared/constants'

const WebSocketMock = vi.hoisted(() =>
  vi.fn(function WebSocketMock() {
    return {}
  })
)

vi.mock('ws', () => ({ WebSocket: WebSocketMock }))

import { createCvrSocket, createVrcSocket } from './socketFactory'

describe('production WebSocket factories', () => {
  beforeEach(() => {
    WebSocketMock.mockClear()
  })

  it('bounds the VRChat Pipeline handshake with the API timeout', () => {
    createVrcSocket('wss://pipeline.example')

    expect(WebSocketMock).toHaveBeenCalledWith('wss://pipeline.example', {
      headers: { 'User-Agent': expect.stringMatching(/^VRX\//) },
      handshakeTimeout: API_TIMEOUT_MS
    })
  })

  it('bounds the CVR handshake while preserving its upgrade headers', () => {
    const headers = {
      Username: 'user',
      AccessKey: 'key',
      Platform: 'pc_standalone',
      'User-Agent': 'VRX/test'
    }

    createCvrSocket('wss://cvr.example', headers)

    expect(WebSocketMock).toHaveBeenCalledWith('wss://cvr.example', {
      headers,
      handshakeTimeout: API_TIMEOUT_MS
    })
  })
})
