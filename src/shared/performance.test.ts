import { describe, expect, it } from 'vitest'
import {
  CPU_SAMPLE_MAX_GAP_MS,
  PerformanceSampler,
  formatByteSize,
  formatCpuPercent,
  formatDurationMs,
  formatPerformanceReport,
  formatWorkingSetKiB,
  type PerformanceFacts,
  type RawPerformanceProcess
} from './performance'

const facts: PerformanceFacts = {
  version: '1.5.0',
  channel: 'dev',
  platform: 'linux',
  arch: 'x64',
  osRelease: '6.12.113',
  packaged: false,
  mainHeapUsedBytes: 1.5 * 1024 * 1024,
  windowReadyMs: 842,
  firstRenderMs: 910,
  sockets: { vrchat: 'live', chilloutvr: 'down' }
}

function raw(overrides: Partial<RawPerformanceProcess> = {}): RawPerformanceProcess {
  return {
    pid: 100,
    type: 'Browser',
    workingSetKiB: 1536,
    cumulativeCpuSeconds: 10,
    ...overrides
  }
}

describe('working set and heap units', () => {
  it('shows KiB from Electron as KB under 1024 and MB from 1024, at 1024 KB per MB', () => {
    expect(formatWorkingSetKiB(512)).toBe('512 KB')
    expect(formatWorkingSetKiB(1023)).toBe('1023 KB')
    expect(formatWorkingSetKiB(1024)).toBe('1.0 MB')
    expect(formatWorkingSetKiB(1536)).toBe('1.5 MB')
    expect(formatWorkingSetKiB(0)).toBe('0 KB')
    expect(formatWorkingSetKiB(Number.NaN)).toBe('0 KB')
  })

  it('shows a byte heap with the same rule, so 1.5 MiB is not labeled KB', () => {
    expect(formatByteSize(1.5 * 1024 * 1024)).toBe('1.5 MB')
    expect(formatByteSize(512 * 1024)).toBe('512 KB')
    expect(formatByteSize(0)).toBe('0 KB')
  })
})

describe('PerformanceSampler', () => {
  it('returns null CPU on the first reading even when cumulative time is already large', () => {
    const now = 1_000
    const sampler = new PerformanceSampler(
      () => [raw()],
      () => facts,
      () => now
    )
    const first = sampler.sample()

    expect(first.cpuIntervalMs).toBeNull()
    expect(first.processes[0]?.cpuPercent).toBeNull()
    expect(first.totalWorkingSetKiB).toBe(1536)
    expect(first.processes[0]).toMatchObject({ kind: 'browser', workingSetKiB: 1536 })
    expect(formatCpuPercent(first.processes[0]?.cpuPercent ?? null)).toBe('measuring')
  })

  it('turns a later cumulative delta into percent of one core, not the cumulative seconds', () => {
    let now = 1_000
    let cumulative = 10
    const sampler = new PerformanceSampler(
      () => [raw({ cumulativeCpuSeconds: cumulative })],
      () => facts,
      () => now
    )
    sampler.sample()
    now += 2_000
    cumulative = 10.5
    const second = sampler.sample()

    expect(second.cpuIntervalMs).toBe(2_000)
    expect(second.processes[0]?.cpuPercent).toBe(25)
    expect(second.processes[0]?.cpuPercent).not.toBe(10.5)
  })

  it('keeps a sample at the gap limit and drops one just past it', () => {
    let now = 1_000
    let cumulative = 10
    const sampler = new PerformanceSampler(
      () => [raw({ cumulativeCpuSeconds: cumulative })],
      () => facts,
      () => now
    )
    sampler.sample()
    now += CPU_SAMPLE_MAX_GAP_MS
    cumulative += (CPU_SAMPLE_MAX_GAP_MS / 1000) * 0.25
    expect(sampler.sample().processes[0]?.cpuPercent).toBe(25)

    now += CPU_SAMPLE_MAX_GAP_MS + 1
    cumulative += 5
    const afterGap = sampler.sample()
    expect(afterGap.cpuIntervalMs).toBeNull()
    expect(afterGap.processes[0]?.cpuPercent).toBeNull()
  })

  it('leaves CPU null for a new process and for a cumulative time that went backwards', () => {
    let now = 5_000
    let rows = [raw({ pid: 1, cumulativeCpuSeconds: 4 })]
    const sampler = new PerformanceSampler(
      () => rows,
      () => facts,
      () => now
    )
    sampler.sample()
    now += 1_000
    rows = [
      raw({ pid: 1, cumulativeCpuSeconds: 3 }),
      raw({ pid: 2, type: 'Tab', cumulativeCpuSeconds: 1, workingSetKiB: 512 })
    ]
    const next = sampler.sample()
    expect(next.processes.map((entry) => [entry.pid, entry.cpuPercent])).toEqual([
      [1, null],
      [2, null]
    ])
  })

  it('names the four process kinds, drops a path-like name, and sums the working sets', () => {
    const sampler = new PerformanceSampler(
      () => [
        raw({ pid: 4, type: 'Utility', serviceName: 'Network Service', workingSetKiB: 100 }),
        raw({ pid: 2, type: 'Tab', name: '/tmp/renderer', workingSetKiB: 200 }),
        raw({
          pid: 3,
          type: 'GPU',
          name: 'GPU',
          serviceName: 'gpu.mojom',
          workingSetKiB: 300
        }),
        raw({
          pid: 5,
          type: 'Utility',
          name: 'Network Service',
          serviceName: 'network.mojom.NetworkService',
          workingSetKiB: 80
        }),
        raw({ pid: 9, type: 'Zygote', workingSetKiB: 50 }),
        raw({ pid: 1, type: 'Browser', workingSetKiB: 400 })
      ],
      () => facts,
      () => 10
    )
    const snapshot = sampler.sample()

    expect(snapshot.processes.map((entry) => [entry.kind, entry.pid, entry.name])).toEqual([
      ['browser', 1, null],
      ['renderer', 2, null],
      ['gpu', 3, null],
      ['utility', 4, 'Network Service'],
      ['utility', 5, 'Network Service'],
      ['other', 9, null]
    ])
    expect(snapshot.totalWorkingSetKiB).toBe(1130)
  })
})

describe('formatPerformanceReport', () => {
  it('pastes version, channel, OS and the same units the page shows, and omits a missing renderer heap', () => {
    const sampler = new PerformanceSampler(
      () => [raw()],
      () => facts,
      () => 1_000
    )
    const snapshot = sampler.sample()
    const report = formatPerformanceReport(snapshot, null)

    expect(report).toContain('Version: 1.5.0')
    expect(report).toContain('Channel: dev')
    expect(report).toContain('OS: linux 6.12.113 (x64)')
    expect(report).toContain('Packaged: no')
    expect(report).toContain('Window ready: 842 ms')
    expect(report).toContain('First render: 910 ms')
    expect(report).toContain('Working set: 1.5 MB')
    expect(report).toContain('Main JS heap: 1.5 MB')
    expect(report).not.toContain('Renderer JS heap')
    expect(report).toContain('CPU: measuring')
    expect(report).toContain('Main pid 100  1.5 MB  measuring')
    expect(report).toContain('VRChat: Live')
    expect(report).toContain('ChilloutVR: Down')
    expect(report).not.toContain('0.0%')
  })

  it('includes a renderer heap when the page measured one', () => {
    const sampler = new PerformanceSampler(
      () => [raw({ workingSetKiB: 512 })],
      () => facts,
      () => 1
    )
    const report = formatPerformanceReport(sampler.sample(), 512 * 1024)
    expect(report).toContain('Working set: 512 KB')
    expect(report).toContain('Renderer JS heap: 512 KB')
  })
})

describe('formatDurationMs', () => {
  it('keeps milliseconds and does not invent a startup time', () => {
    expect(formatDurationMs(842)).toBe('842 ms')
    expect(formatDurationMs(null)).toBe('not yet')
  })
})
