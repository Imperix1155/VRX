// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { formatReadAt, type PerformanceSnapshot } from '@shared/performance'
import i18n from '../i18n'
import PerformanceSettings from './PerformanceSettings'

const msg = (key: string): string => i18n.t(key)

const snapshot: PerformanceSnapshot = {
  version: '1.5.0',
  channel: 'dev',
  platform: 'linux',
  arch: 'x64',
  osRelease: '6.12.113',
  packaged: false,
  totalWorkingSetKiB: 1536,
  processes: [
    {
      pid: 10,
      kind: 'renderer',
      name: null,
      workingSetKiB: 1536,
      cpuPercent: null
    },
    {
      pid: 11,
      kind: 'gpu',
      name: null,
      workingSetKiB: 512,
      cpuPercent: 25
    }
  ],
  mainHeapUsedBytes: 1.5 * 1024 * 1024,
  windowReadyMs: 842,
  firstRenderMs: null,
  cpuIntervalMs: null,
  sockets: { vrchat: 'live', chilloutvr: 'down' }
}

function renderPage(getPerformance: () => Promise<PerformanceSnapshot>): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  ;(window as unknown as { vrx?: { getPerformance: typeof getPerformance } }).vrx = {
    getPerformance
  }
  render(
    <QueryClientProvider client={client}>
      <PerformanceSettings />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'vrx')
  Reflect.deleteProperty(performance, 'memory')
  vi.useRealTimers()
})

describe('PerformanceSettings', () => {
  it('shows working set in MB, a small process in KB, and measuring instead of 0% CPU', async () => {
    renderPage(() => Promise.resolve(snapshot))

    expect(await screen.findByText(/Window ready 842 ms/)).toBeTruthy()
    expect(screen.getAllByText('1.5 MB').length).toBeGreaterThan(0)
    expect(screen.getByText('512 KB')).toBeTruthy()
    expect(screen.getByText(msg('settings.performance.measuring'))).toBeTruthy()
    expect(screen.getByText('25.0%')).toBeTruthy()
    expect(screen.getByText(/First render Not yet/)).toBeTruthy()
    expect(screen.getByText('Sockets: VRChat Live · ChilloutVR Down')).toBeTruthy()
    expect(
      screen.queryByText(msg('settings.performance.rendererHeap'), { exact: false })
    ).toBeNull()
  })

  it('copies an English snapshot that uses the same units', async () => {
    const copied: string[] = []
    const writeText = vi.fn((text: string) => {
      copied.push(text)
      return Promise.resolve()
    })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPage(() => Promise.resolve(snapshot))
    await screen.findByText(/Window ready 842 ms/)

    fireEvent.click(screen.getByRole('button', { name: msg('settings.performance.copy') }))
    await waitFor(() => expect(copied).toHaveLength(1))
    const report = copied[0] ?? ''
    expect(report).toContain('Version: 1.5.0')
    expect(report).toContain('Channel: dev')
    expect(report).toContain('Working set: 1.5 MB')
    expect(report).toContain('Renderer pid 10  1.5 MB  measuring')
    expect(report).toContain('GPU pid 11  512 KB  25.0%')
    expect(report).not.toContain('0.0%')
    expect(report).not.toContain("Couldn't refresh")
    expect(
      await screen.findByRole('button', { name: msg('settings.performance.copied') })
    ).toBeTruthy()
  })

  it('shows the renderer JS heap in MB when the renderer exposes it', async () => {
    Object.defineProperty(performance, 'memory', {
      value: { usedJSHeapSize: 1.5 * 1024 * 1024 },
      configurable: true
    })
    renderPage(() => Promise.resolve(snapshot))
    expect(await screen.findByText(/Renderer JS heap 1\.5 MB/)).toBeTruthy()
  })

  it('keeps the last numbers when a refresh fails, and the copy includes that same line', async () => {
    const readAt = new Date('2026-11-25T15:04:05Z')
    vi.useFakeTimers()
    vi.setSystemTime(readAt)
    let calls = 0
    const getPerformance = vi.fn(() => {
      calls += 1
      if (calls === 1) return Promise.resolve(snapshot)
      return Promise.reject(new Error('unavailable'))
    })
    const copied: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: (text: string) => {
          copied.push(text)
          return Promise.resolve()
        }
      },
      configurable: true
    })
    renderPage(getPerformance)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText(/Window ready 842 ms/)).toBeTruthy()
    expect(screen.queryByText(/Couldn't refresh/)).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    const staleLine = i18n.t('settings.performance.refreshFailed', {
      time: formatReadAt(readAt.getTime(), i18n.language)
    })
    expect(calls).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(staleLine)).toBeTruthy()
    expect(screen.getByText(/Window ready 842 ms/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: msg('settings.performance.copy') }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(copied[0]).toContain(staleLine)
  })

  it('stops asking main after the page unmounts', async () => {
    vi.useFakeTimers()
    const getPerformance = vi.fn(() => Promise.resolve(snapshot))
    renderPage(getPerformance)
    await act(async () => {
      await Promise.resolve()
    })
    expect(getPerformance).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(getPerformance.mock.calls.length).toBeGreaterThanOrEqual(2)
    const whileOpen = getPerformance.mock.calls.length

    cleanup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(getPerformance).toHaveBeenCalledTimes(whileOpen)
  })
})
