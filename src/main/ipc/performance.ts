import { app, ipcMain } from 'electron'
import { arch, release } from 'node:os'
import { PerformanceSampler, type RawPerformanceProcess } from '@shared/performance'
import type { AppStatusService } from '../services/appStatus'
import { getSettingsSnapshot } from '../services/settings'
import { startupTiming } from '../services/startupTiming'
import { isTrustedIpcSender } from './security'

interface AppMetricLike {
  pid: number
  type: string
  serviceName?: string
  name?: string
  cpu: { cumulativeCPUUsage?: number }
  memory: { workingSetSize: number }
}

/** `workingSetSize` is already KiB. */
export function rawProcessesFromMetrics(
  metrics: readonly AppMetricLike[]
): RawPerformanceProcess[] {
  return metrics.map((metric) => {
    const cumulative = metric.cpu.cumulativeCPUUsage
    return {
      pid: metric.pid,
      type: metric.type,
      serviceName: metric.serviceName,
      name: metric.name,
      workingSetKiB: metric.memory.workingSetSize,
      cumulativeCpuSeconds: typeof cumulative === 'number' ? cumulative : null
    }
  })
}

export function registerPerformanceHandlers(
  appStatus: Pick<AppStatusService, 'snapshot'>,
  now: () => number = () => Date.now()
): void {
  const sampler = new PerformanceSampler(
    () => rawProcessesFromMetrics(app.getAppMetrics()),
    () => {
      const startup = startupTiming.snapshot()
      const heap = process.memoryUsage().heapUsed
      return {
        version: app.getVersion(),
        channel: getSettingsSnapshot().updateChannel,
        platform: process.platform,
        arch: arch(),
        osRelease: release(),
        packaged: app.isPackaged,
        mainHeapUsedBytes: heap,
        windowReadyMs: startup.windowReadyMs,
        firstRenderMs: startup.firstRenderMs,
        sockets: appStatus.snapshot().ws
      }
    },
    now
  )

  ipcMain.handle('get-performance', (event) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    return sampler.sample()
  })
}
