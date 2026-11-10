import { describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  onChannels: [] as string[],
  handleChannels: [] as string[]
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/vrx-test'),
    isPackaged: false
  },
  ipcMain: {
    on: vi.fn((channel: string) => electron.onChannels.push(channel)),
    handle: vi.fn((channel: string) => electron.handleChannels.push(channel))
  }
}))

vi.mock('electron-log/node', () => ({
  default: {
    hooks: [],
    info: vi.fn(),
    transports: {
      console: { level: 'debug' },
      file: {
        getFile: () => ({ path: '/tmp/vrx-test/main.log' }),
        level: 'info',
        resolvePathFn: vi.fn()
      }
    }
  }
}))

vi.mock('electron-log/main', () => {
  electron.onChannels.push('__ELECTRON_LOG__')
  electron.handleChannels.push('__ELECTRON_LOG__')
  return {
    default: {
      hooks: [],
      info: vi.fn(),
      initialize: vi.fn(),
      transports: {
        console: { level: 'debug' },
        file: {
          getFile: () => ({ path: '/tmp/vrx-test/main.log' }),
          level: 'info',
          resolvePathFn: vi.fn()
        }
      }
    }
  }
})

import log from 'electron-log/node'
import { initLogger } from './logger'

describe('main-only logger', () => {
  it('registers no renderer-reachable IPC channels when imported', () => {
    expect(electron.onChannels).toEqual([])
    expect(electron.handleChannels).toEqual([])
  })
})

describe('log redaction hook', () => {
  it('leaves out details a call site did not pass, and keeps real ones', () => {
    initLogger()
    const hook = (
      log.hooks as unknown as Array<(m: { data: unknown[] }) => { data: unknown[] }>
    ).at(-1)!
    expect(hook({ data: ['pipeline: connected', undefined] }).data).toEqual(['pipeline: connected'])
    expect(hook({ data: ['count', { n: 1 }] }).data).toEqual(['count', { n: 1 }])
    expect(hook({ data: [undefined] }).data).toEqual([undefined])
  })
})
