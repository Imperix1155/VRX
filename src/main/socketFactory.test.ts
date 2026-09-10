import { beforeEach, describe, expect, it, vi } from 'vitest'
import { API_TIMEOUT_MS } from '@shared/constants'

const WebSocketMock = vi.hoisted(() =>
  vi.fn(function WebSocketMock() {
    return {}
  })
)

vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events')
  WebSocketMock.mockImplementation(function () {
    return Object.assign(new EventEmitter(), { terminate: vi.fn() })
  })
  return { WebSocket: WebSocketMock }
})

import { createCvrSocket, createVrcSocket } from './socketFactory'

describe('production WebSocket factories', () => {
  beforeEach(() => {
    WebSocketMock.mockClear()
  })

  it.each(['vrchat', 'chilloutvr'] as const)(
    'sanitizes and disposes a rejected %s upgrade',
    (platform) => {
      const socket =
        platform === 'vrchat'
          ? createVrcSocket('wss://fixture.example')
          : createCvrSocket('wss://fixture.example', { AccessKey: 'fixture-secret' })
      const rejected = vi.fn()
      socket.on('upgrade-rejected', rejected)
      const response = {
        statusCode: 429,
        headers: { 'retry-after': '60', 'set-cookie': 'fixture-secret' },
        resume: vi.fn(),
        destroy: vi.fn()
      }
      socket.emit('unexpected-response', { secret: 'fixture-secret' }, response)
      expect(rejected).toHaveBeenCalledExactlyOnceWith({ statusCode: 429, retryAfter: '60' })
      expect(response.resume).toHaveBeenCalledOnce()
      expect(response.destroy).toHaveBeenCalledOnce()
      expect(socket.terminate).toHaveBeenCalledOnce()
      expect(JSON.stringify(rejected.mock.calls)).not.toContain('fixture-secret')
    }
  )

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
