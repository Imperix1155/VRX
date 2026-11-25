import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { ConnectionHealth, Platform } from '@shared/types'
import {
  formatByteSize,
  formatCpuPercent,
  formatDurationMs,
  formatPerformanceReport,
  formatWorkingSetKiB,
  type PerformanceProcessKind,
  type PerformanceSnapshot
} from '@shared/performance'

const PERFORMANCE_POLL_MS = 2_000
const COPY_RESULT_MS = 2_000

const KIND_LABEL_KEYS: Record<PerformanceProcessKind, string> = {
  browser: 'settings.performance.kind.browser',
  renderer: 'settings.performance.kind.renderer',
  gpu: 'settings.performance.kind.gpu',
  utility: 'settings.performance.kind.utility',
  other: 'settings.performance.kind.other'
}

const SOCKET_KEYS: Record<ConnectionHealth, string> = {
  live: 'shell.connection.live',
  reconnecting: 'shell.connection.reconnecting',
  down: 'shell.connection.down'
}

const PLATFORM_LABEL_KEYS: Record<Platform, string> = {
  vrchat: 'friends.platform.vrchat',
  chilloutvr: 'friends.platform.chilloutvr'
}

type CopyState = 'idle' | 'copied' | 'failed'

function readRendererJsHeapBytes(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: unknown } }).memory
  const used = memory?.usedJSHeapSize
  return typeof used === 'number' && Number.isFinite(used) && used >= 0 ? used : null
}

function startupText(label: string, ms: number | null, notYet: string): string {
  return `${label} ${ms === null ? notYet : formatDurationMs(ms)}`
}

export default function PerformanceSettings(): React.JSX.Element {
  const { t } = useTranslation()
  const { data, isError } = useQuery({
    queryKey: ['performance'],
    queryFn: async (): Promise<PerformanceSnapshot> => {
      const read = window.vrx?.getPerformance
      if (!read) throw new Error('unavailable')
      return read()
    },
    refetchInterval: PERFORMANCE_POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
    networkMode: 'always',
    staleTime: 0,
    gcTime: 0
  })
  const rendererHeapBytes = data === undefined ? null : readRendererJsHeapBytes()
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (resetTimer.current !== null) clearTimeout(resetTimer.current)
    }
  }, [])

  function showCopy(outcome: Exclude<CopyState, 'idle'>): void {
    if (!mounted.current) return
    setCopyState(outcome)
    if (resetTimer.current !== null) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setCopyState('idle'), COPY_RESULT_MS)
  }

  function copyReport(): void {
    if (data === undefined) return
    const text = formatPerformanceReport(data, readRendererJsHeapBytes())
    let writing: Promise<void>
    try {
      writing = navigator.clipboard.writeText(text)
    } catch {
      showCopy('failed')
      return
    }
    writing.then(
      () => showCopy('copied'),
      () => showCopy('failed')
    )
  }

  const copyWord =
    copyState === 'copied'
      ? t('settings.performance.copied')
      : copyState === 'failed'
        ? t('settings.performance.copyFailed')
        : t('settings.performance.copy')

  return (
    <section className="settings-cards" aria-labelledby="settings-performance-heading">
      <h2 id="settings-performance-heading" className="sr-only">
        {t('settings.performance.heading')}
      </h2>

      <div className="setting-card setting-row">
        <div>
          <p className="text-sm font-medium text-[var(--text)]">
            {t('settings.performance.workingSet')}
          </p>
          <p className="mt-[var(--space-0-5)] text-xs text-[var(--text-dim)]">
            {t('settings.performance.description')}
          </p>
          {data !== undefined ? (
            <>
              <p className="mt-[var(--space-1)] text-sm font-semibold tabular-nums text-[var(--text)]">
                {formatWorkingSetKiB(data.totalWorkingSetKiB)}
              </p>
              <p className="mt-[var(--space-0-5)] text-xs text-[var(--text-dim)]">
                {t('settings.performance.workingSetNote')}
              </p>
              <p className="mt-[var(--space-1)] text-xs tabular-nums text-[var(--text)]">
                {startupText(
                  t('settings.performance.windowReady'),
                  data.windowReadyMs,
                  t('settings.performance.notYet')
                )}
                {' · '}
                {startupText(
                  t('settings.performance.firstRender'),
                  data.firstRenderMs,
                  t('settings.performance.notYet')
                )}
              </p>
              <p className="text-xs text-[var(--text-dim)]">
                {t('settings.performance.startupNote')}
              </p>
              <p className="mt-[var(--space-1)] text-xs tabular-nums text-[var(--text)]">
                {t('settings.performance.mainHeap')} {formatByteSize(data.mainHeapUsedBytes)}
                {rendererHeapBytes === null
                  ? ''
                  : ` · ${t('settings.performance.rendererHeap')} ${formatByteSize(rendererHeapBytes)}`}
              </p>
              <p className="mt-[var(--space-1)] text-xs text-[var(--text)]">
                {`${t('settings.performance.sockets')}: ${t(PLATFORM_LABEL_KEYS.vrchat)} ${t(SOCKET_KEYS[data.sockets.vrchat])} · ${t(PLATFORM_LABEL_KEYS.chilloutvr)} ${t(SOCKET_KEYS[data.sockets.chilloutvr])}`}
              </p>
            </>
          ) : (
            <p className="mt-[var(--space-1)] text-xs text-[var(--text-dim)]" role="status">
              {isError
                ? t('settings.performance.unavailable')
                : t('settings.performance.measuring')}
            </p>
          )}
        </div>
        <button
          type="button"
          data-copy-state={copyState}
          disabled={data === undefined}
          onClick={copyReport}
          className={[
            'shrink-0 px-[var(--space-3)] py-[var(--space-1)] rounded-[10px] text-[13px] font-medium',
            'border border-[var(--border)]',
            'bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)]',
            'text-[var(--text)]',
            'focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)]',
            'cursor-pointer disabled:cursor-not-allowed disabled:opacity-50'
          ].join(' ')}
        >
          {copyWord}
        </button>
        <span role="status" className="sr-only">
          {copyState === 'idle' ? '' : copyWord}
        </span>
      </div>

      {data !== undefined ? (
        <div className="setting-card">
          <p className="text-sm font-medium text-[var(--text)]">
            {t('settings.performance.processes')}
          </p>
          <p className="mt-[var(--space-0-5)] text-xs text-[var(--text-dim)]">
            {data.cpuIntervalMs === null
              ? t('settings.performance.cpuNote')
              : t('settings.performance.cpuInterval', {
                  seconds: (data.cpuIntervalMs / 1000).toFixed(1)
                })}
          </p>
          <table className="mt-[var(--space-2)] w-full text-xs">
            <caption className="sr-only">{t('settings.performance.processes')}</caption>
            <thead>
              <tr className="text-[var(--text-dim)]">
                <th scope="col" className="pb-[var(--space-1)] text-left font-medium">
                  {t('settings.performance.process')}
                </th>
                <th scope="col" className="pb-[var(--space-1)] text-right font-medium">
                  {t('settings.performance.memory')}
                </th>
                <th scope="col" className="pb-[var(--space-1)] text-right font-medium">
                  {t('settings.performance.cpu')}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.processes.map((entry) => (
                <tr key={entry.pid} className="text-[var(--text)]">
                  <th scope="row" className="py-[2px] text-left font-medium">
                    {t(KIND_LABEL_KEYS[entry.kind])}
                    {entry.name !== null ? (
                      <span className="font-normal text-[var(--text-dim)]"> {entry.name}</span>
                    ) : null}
                    <span className="font-normal tabular-nums text-[var(--text-dim)]">
                      {' '}
                      {entry.pid}
                    </span>
                  </th>
                  <td className="py-[2px] text-right tabular-nums">
                    {formatWorkingSetKiB(entry.workingSetKiB)}
                  </td>
                  <td className="py-[2px] text-right tabular-nums">
                    {entry.cpuPercent === null
                      ? t('settings.performance.measuring')
                      : formatCpuPercent(entry.cpuPercent)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
