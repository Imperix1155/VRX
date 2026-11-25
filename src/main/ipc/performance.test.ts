import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

const handlers = new Map<string, (event: unknown) => unknown>()
const metrics = vi.hoisted(() => ({
  value: [] as Array<{
    pid: number
    type: string
    serviceName?: string
    name?: string
    cpu: { cumulativeCPUUsage?: number }
    memory: { workingSetSize: number }
  }>
}))

vi.mock('electron', () => ({
  app: {
    getAppMetrics: () => metrics.value,
    getVersion: () => '9.9.9',
    isPackaged: false
  },
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown) => unknown) => {
      handlers.set(channel, fn)
    })
  }
}))

vi.mock('node:os', () => ({
  arch: () => 'x64',
  release: () => '6.12.113'
}))

const trusted = vi.hoisted(() => ({ value: true }))
vi.mock('./security', () => ({
  isTrustedIpcSender: vi.fn(() => trusted.value)
}))

vi.mock('../services/settings', () => ({
  getSettingsSnapshot: () => ({ updateChannel: 'beta' })
}))

vi.mock('../services/startupTiming', () => ({
  startupTiming: {
    snapshot: () => ({ windowReadyMs: 800, firstRenderMs: 900 })
  }
}))

import { rawProcessesFromMetrics, registerPerformanceHandlers } from './performance'

const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent
const status = {
  snapshot: () => ({
    ws: { vrchat: 'live' as const, chilloutvr: 'reconnecting' as const },
    lastReconcileAt: { vrchat: null, chilloutvr: null }
  })
}

beforeEach(() => {
  handlers.clear()
  trusted.value = true
  metrics.value = [
    {
      pid: 10,
      type: 'Tab',
      cpu: { cumulativeCPUUsage: 4 },
      memory: { workingSetSize: 1536 }
    }
  ]
})

describe('rawProcessesFromMetrics', () => {
  it('keeps Electron working set in KiB and ignores a missing cumulative CPU time', () => {
    expect(
      rawProcessesFromMetrics([
        {
          pid: 10,
          type: 'Tab',
          serviceName: 'Network Service',
          cpu: {},
          memory: { workingSetSize: 1536 }
        }
      ])
    ).toEqual([
      {
        pid: 10,
        type: 'Tab',
        serviceName: 'Network Service',
        name: undefined,
        workingSetKiB: 1536,
        cumulativeCpuSeconds: null
      }
    ])
  })
})

describe('get-performance', () => {
  it('rejects an untrusted sender before reading metrics', () => {
    const now = vi.fn(() => 1_000)
    registerPerformanceHandlers(status, now)
    trusted.value = false
    expect(() => handlers.get('get-performance')!(event)).toThrow('Untrusted IPC sender')
    expect(now).not.toHaveBeenCalled()
  })

  it('reports the working set in KiB and withholds CPU until a second reading', () => {
    let now = 5_000
    registerPerformanceHandlers(status, () => now)
    const first = handlers.get('get-performance')!(event) as {
      version: string
      channel: string
      osRelease: string
      totalWorkingSetKiB: number
      windowReadyMs: number
      cpuIntervalMs: number | null
      processes: Array<{ kind: string; workingSetKiB: number; cpuPercent: number | null }>
      sockets: { vrchat: string; chilloutvr: string }
    }

    expect(first.version).toBe('9.9.9')
    expect(first.channel).toBe('beta')
    expect(first.osRelease).toBe('6.12.113')
    expect(first.totalWorkingSetKiB).toBe(1536)
    expect(first.processes[0]).toMatchObject({
      kind: 'renderer',
      workingSetKiB: 1536,
      cpuPercent: null
    })
    expect(first.windowReadyMs).toBe(800)
    expect(first.sockets).toEqual({ vrchat: 'live', chilloutvr: 'reconnecting' })

    now += 2_000
    metrics.value = [
      {
        pid: 10,
        type: 'Tab',
        cpu: { cumulativeCPUUsage: 4.5 },
        memory: { workingSetSize: 2048 }
      }
    ]
    const second = handlers.get('get-performance')!(event) as {
      totalWorkingSetKiB: number
      cpuIntervalMs: number | null
      processes: Array<{ cpuPercent: number | null }>
    }
    expect(second.totalWorkingSetKiB).toBe(2048)
    expect(second.cpuIntervalMs).toBe(2_000)
    expect(second.processes[0]?.cpuPercent).toBe(25)
  })
})
