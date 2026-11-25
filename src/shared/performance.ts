import type { ConnectionHealth, Platform, UpdateChannel } from './types'

export const PERFORMANCE_PROCESS_KINDS = ['browser', 'renderer', 'gpu', 'utility', 'other'] as const
export type PerformanceProcessKind = (typeof PERFORMANCE_PROCESS_KINDS)[number]

export const CPU_SAMPLE_MAX_GAP_MS = 3_500

export interface PerformanceProcess {
  pid: number
  kind: PerformanceProcessKind
  name: string | null
  workingSetKiB: number
  cpuPercent: number | null
}

export interface PerformanceSnapshot {
  version: string
  channel: UpdateChannel
  platform: string
  arch: string
  osRelease: string
  packaged: boolean
  totalWorkingSetKiB: number
  processes: PerformanceProcess[]
  mainHeapUsedBytes: number
  windowReadyMs: number | null
  firstRenderMs: number | null
  cpuIntervalMs: number | null
  sockets: Record<Platform, ConnectionHealth>
}

export interface RawPerformanceProcess {
  pid: number
  type: string
  serviceName?: string
  name?: string
  workingSetKiB: number
  cumulativeCpuSeconds: number | null
}

export interface PerformanceFacts {
  version: string
  channel: UpdateChannel
  platform: string
  arch: string
  osRelease: string
  packaged: boolean
  mainHeapUsedBytes: number
  windowReadyMs: number | null
  firstRenderMs: number | null
  sockets: Record<Platform, ConnectionHealth>
}

interface CpuBaseline {
  at: number
  secondsByPid: Map<number, number>
}

const KIND_ORDER = new Map(PERFORMANCE_PROCESS_KINDS.map((kind, index) => [kind, index]))

export function performanceProcessKind(type: string): PerformanceProcessKind {
  if (type === 'Browser') return 'browser'
  if (type === 'Tab') return 'renderer'
  if (type === 'GPU') return 'gpu'
  if (type === 'Utility') return 'utility'
  return 'other'
}

function processName(raw: RawPerformanceProcess, kind: PerformanceProcessKind): string | null {
  const value = (raw.name ?? raw.serviceName ?? '').trim()
  if (value === '' || value.length > 80) return null
  if (value.includes('/') || value.includes('\\')) return null
  if (value.toLowerCase() === raw.type.toLowerCase()) return null
  if (value.toLowerCase() === kind) return null
  return value
}

function wholeKiB(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round(value)
}

function wholeBytes(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round(value)
}

function cpuPercent(before: number, after: number, intervalMs: number): number | null {
  if (!Number.isFinite(before) || !Number.isFinite(after) || after < before) return null
  const percent = ((after - before) / (intervalMs / 1000)) * 100
  if (!Number.isFinite(percent) || percent < 0) return null
  return Math.round(percent * 10) / 10
}

/** `percentCPUUsage` is unread: `app.getAppMetrics()` resets that interval for every process. */
export class PerformanceSampler {
  private baseline: CpuBaseline | null = null

  constructor(
    private readonly read: () => readonly RawPerformanceProcess[],
    private readonly facts: () => PerformanceFacts,
    private readonly now: () => number = () => Date.now()
  ) {}

  sample(): PerformanceSnapshot {
    const at = this.now()
    const raw = this.read()
    const previous = this.baseline
    const intervalMs =
      previous !== null && at > previous.at && at - previous.at <= CPU_SAMPLE_MAX_GAP_MS
        ? at - previous.at
        : null
    const secondsByPid = new Map<number, number>()
    const processes: PerformanceProcess[] = []

    for (const entry of raw) {
      if (!Number.isInteger(entry.pid) || entry.pid <= 0) continue
      const cumulative =
        typeof entry.cumulativeCpuSeconds === 'number' &&
        Number.isFinite(entry.cumulativeCpuSeconds)
          ? entry.cumulativeCpuSeconds
          : null
      if (cumulative !== null) secondsByPid.set(entry.pid, cumulative)
      const before = intervalMs === null ? undefined : previous?.secondsByPid.get(entry.pid)
      const kind = performanceProcessKind(entry.type)
      processes.push({
        pid: entry.pid,
        kind,
        name: processName(entry, kind),
        workingSetKiB: wholeKiB(entry.workingSetKiB),
        cpuPercent:
          intervalMs === null || before === undefined || cumulative === null
            ? null
            : cpuPercent(before, cumulative, intervalMs)
      })
    }

    processes.sort(
      (a, b) => (KIND_ORDER.get(a.kind) ?? 0) - (KIND_ORDER.get(b.kind) ?? 0) || a.pid - b.pid
    )
    this.baseline = { at, secondsByPid }

    const info = this.facts()
    const totalWorkingSetKiB = processes.reduce((sum, process) => sum + process.workingSetKiB, 0)
    return {
      version: info.version,
      channel: info.channel,
      platform: info.platform,
      arch: info.arch,
      osRelease: info.osRelease,
      packaged: info.packaged,
      totalWorkingSetKiB,
      processes,
      mainHeapUsedBytes: wholeBytes(info.mainHeapUsedBytes),
      windowReadyMs: info.windowReadyMs,
      firstRenderMs: info.firstRenderMs,
      cpuIntervalMs: intervalMs,
      sockets: info.sockets
    }
  }
}

export function formatWorkingSetKiB(kiB: number): string {
  if (!Number.isFinite(kiB) || kiB <= 0) return '0 KB'
  if (kiB >= 1024) return `${(kiB / 1024).toFixed(1)} MB`
  return `${Math.round(kiB)} KB`
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  return formatWorkingSetKiB(bytes / 1024)
}

export function formatCpuPercent(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent)) return 'measuring'
  return `${percent.toFixed(1)}%`
}

export function formatDurationMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return 'not yet'
  return `${Math.round(ms)} ms`
}

const REPORT_KIND: Record<PerformanceProcessKind, string> = {
  browser: 'Main',
  renderer: 'Renderer',
  gpu: 'GPU',
  utility: 'Utility',
  other: 'Other'
}

const REPORT_SOCKET: Record<ConnectionHealth, string> = {
  live: 'Live',
  reconnecting: 'Connecting',
  down: 'Down'
}

export function formatPerformanceReport(
  snapshot: PerformanceSnapshot,
  rendererHeapBytes: number | null
): string {
  const lines = [
    'VRX performance',
    `Version: ${snapshot.version}`,
    `Channel: ${snapshot.channel}`,
    `OS: ${snapshot.platform} ${snapshot.osRelease} (${snapshot.arch})`,
    `Packaged: ${snapshot.packaged ? 'yes' : 'no'}`,
    `Window ready: ${formatDurationMs(snapshot.windowReadyMs)}`,
    `First render: ${formatDurationMs(snapshot.firstRenderMs)}`,
    `Working set: ${formatWorkingSetKiB(snapshot.totalWorkingSetKiB)}`,
    `Main JS heap: ${formatByteSize(snapshot.mainHeapUsedBytes)}`
  ]
  if (rendererHeapBytes !== null && Number.isFinite(rendererHeapBytes) && rendererHeapBytes >= 0) {
    lines.push(`Renderer JS heap: ${formatByteSize(rendererHeapBytes)}`)
  }
  lines.push(
    snapshot.cpuIntervalMs === null
      ? 'CPU: measuring'
      : `CPU interval: ${Math.round(snapshot.cpuIntervalMs)} ms`
  )
  lines.push('Processes:')
  for (const entry of snapshot.processes) {
    const name = entry.name === null ? '' : ` ${entry.name}`
    lines.push(
      `${REPORT_KIND[entry.kind]}${name} pid ${entry.pid}  ${formatWorkingSetKiB(entry.workingSetKiB)}  ${formatCpuPercent(entry.cpuPercent)}`
    )
  }
  lines.push(`VRChat: ${REPORT_SOCKET[snapshot.sockets.vrchat]}`)
  lines.push(`ChilloutVR: ${REPORT_SOCKET[snapshot.sockets.chilloutvr]}`)
  return lines.join('\n')
}
