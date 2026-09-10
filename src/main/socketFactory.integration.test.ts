import { createServer } from 'node:http'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { createCvrSocket, createVrcSocket } from './socketFactory'

describe('real ws rejected-upgrade cleanup', () => {
  it.each(['vrchat', 'chilloutvr'] as const)(
    'closes a rejected %s response without waiting for its body to end',
    async (platform) => {
      const server = createServer((_request, response) => {
        response.writeHead(429, { 'Retry-After': '60' })
        response.write('synthetic unfinished response')
        // Intentionally never end: factory disposal must close the connection.
      })
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing fixture port')
      const url = `ws://127.0.0.1:${address.port}`
      const socket =
        platform === 'vrchat'
          ? createVrcSocket(url)
          : createCvrSocket(url, { 'User-Agent': 'VRX/test' })
      const rejections: unknown[] = []
      socket.on('upgrade-rejected', (value: unknown) => rejections.push(value))
      socket.on('error', () => {})
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('Rejected upgrade did not close')),
            2_000
          )
          socket.once('close', () => {
            clearTimeout(timeout)
            resolve()
          })
        })
        expect(rejections).toEqual([{ statusCode: 429, retryAfter: '60' }])
        expect(socket.readyState).toBe(socket.CLOSED)
      } finally {
        socket.terminate()
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    }
  )
})
