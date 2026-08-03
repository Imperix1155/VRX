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

import './logger'

describe('main-only logger', () => {
  it('registers no renderer-reachable IPC channels when imported', () => {
    expect(electron.onChannels).toEqual([])
    expect(electron.handleChannels).toEqual([])
  })
})
