/**
 * The Dashboard's Quick launch row (owner, 2026-11-18): one slim button per
 * platform that starts the game without joining anyone. It sits under the
 * numbers by default, follows the Dashboard order (`dashboardSections`) and
 * the platform filter, and can be hidden in Settings → Dashboard.
 *
 * Both platforms use one button shape; the platform's name is the label, with
 * its tint behind it. A platform shows once VRX knows an account for it
 * (signed in, or its check is failing), so someone who uses one platform does
 * not get a button for the other.
 *
 * The press names the platform and nothing else: main owns the link, leaves a
 * game that is already open alone, and never calls either platform.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Platform } from '@shared/types'
import { useAuthStatus } from '../queries/auth'
import { useSettingsStore } from '../stores/settings'

/** How long "Starting…" holds the button after main opened the game. */
export const QUICK_LAUNCH_STARTING_MS = 8_000
/** How long "already open" and a failure line stay before clearing themselves. */
export const QUICK_LAUNCH_NOTICE_MS = 10_000

type LaunchStatus = 'idle' | 'starting' | 'already-open'
type LaunchFailure = { platform: Platform; kind: 'failed' | 'busy' }

const PLATFORM_NAME_KEYS: Record<Platform, string> = {
  vrchat: 'dashboard.platformVrc',
  chilloutvr: 'dashboard.platformCvr'
}
/** Quoted literals keep the locale parity scan aware of these keys. */
const STATUS_KEYS: Record<LaunchStatus, string> = {
  idle: 'dashboard.quickLaunch.launch',
  starting: 'dashboard.quickLaunch.starting',
  'already-open': 'dashboard.quickLaunch.alreadyOpen'
}
const FAILURE_KEYS: Record<LaunchFailure['kind'], string> = {
  failed: 'dashboard.quickLaunch.failed',
  busy: 'dashboard.quickLaunch.busy'
}

const IDLE: Readonly<Record<Platform, LaunchStatus>> = { vrchat: 'idle', chilloutvr: 'idle' }

function PlayIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-[16px] w-[16px] flex-none"
    >
      <path d="M8 5.5v13l10.5-6.5L8 5.5Z" />
    </svg>
  )
}

export default function DashboardQuickLaunch({
  platforms
}: {
  /** The platforms in the global filter's scope. */
  platforms: readonly Platform[]
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const headingId = useId()
  const shown = useSettingsStore((s) => s.settings.dashboardQuickLaunch)
  const vrcAuth = useAuthStatus('vrchat').data?.state
  const cvrAuth = useAuthStatus('chilloutvr').data?.state
  const [status, setStatus] = useState(IDLE)
  const [failure, setFailure] = useState<LaunchFailure | null>(null)
  const timers = useRef(new Map<Platform | 'failure', number>())
  const mounted = useRef(true)

  const after = useCallback((key: Platform | 'failure', ms: number, run: () => void): void => {
    window.clearTimeout(timers.current.get(key))
    timers.current.set(key, window.setTimeout(run, ms))
  }, [])

  useEffect(() => {
    const pending = timers.current
    mounted.current = true
    return () => {
      mounted.current = false
      for (const timer of pending.values()) window.clearTimeout(timer)
      pending.clear()
    }
  }, [])

  const launch = useCallback(
    (platform: Platform): void => {
      const launchGame = window.vrx?.launchGame
      if (!launchGame) return
      const settle = (next: LaunchStatus, holdMs: number): void => {
        setStatus((current) => ({ ...current, [platform]: next }))
        if (next !== 'idle') {
          after(platform, holdMs, () =>
            setStatus((current) => ({ ...current, [platform]: 'idle' }))
          )
        }
      }
      const fail = (kind: LaunchFailure['kind']): void => {
        window.clearTimeout(timers.current.get(platform))
        settle('idle', 0)
        setFailure({ platform, kind })
        after('failure', QUICK_LAUNCH_NOTICE_MS, () => setFailure(null))
      }
      setFailure((current) => (current?.platform === platform ? null : current))
      // "Starting…" at once, so the press is answered before main replies.
      settle('starting', QUICK_LAUNCH_STARTING_MS)
      launchGame({ platform }).then(
        (result) => {
          if (!mounted.current) return
          if (!result.ok) fail(result.reason === 'launch-failed' ? 'failed' : 'busy')
          else if (result.state === 'already-open') settle('already-open', QUICK_LAUNCH_NOTICE_MS)
        },
        () => {
          if (mounted.current) fail('failed')
        }
      )
    },
    [after]
  )

  const known = (state: typeof vrcAuth): boolean => state === 'authenticated' || state === 'error'
  const buttons = platforms.filter((platform) => known(platform === 'vrchat' ? vrcAuth : cvrAuth))
  if (!shown || buttons.length === 0) return null
  const statusText = (platform: Platform): string =>
    t(STATUS_KEYS[status[platform]], { platform: t(PLATFORM_NAME_KEYS[platform]) })

  return (
    <section aria-labelledby={headingId} className="mb-[26px]" data-quick-launch="">
      <h2 id={headingId} className="sr-only">
        {t('dashboard.quickLaunch.heading')}
      </h2>
      <ul
        className="grid gap-[14px]"
        style={{ gridTemplateColumns: `repeat(${buttons.length}, minmax(0, 1fr))` }}
      >
        {buttons.map((platform) => {
          const busy = status[platform] !== 'idle'
          return (
            <li key={platform} className={`platform-row platform-row--${platform}`}>
              <button
                type="button"
                aria-disabled={busy || undefined}
                onClick={busy ? undefined : () => launch(platform)}
                className={[
                  'flex min-h-[44px] w-full min-w-0 items-center justify-center gap-[var(--space-2)]',
                  'px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold text-[var(--text)]',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--text-dim)]',
                  'motion-safe:transition-colors',
                  busy ? 'cursor-default' : 'hover:bg-[var(--surface-hover)]'
                ].join(' ')}
              >
                {busy ? null : <PlayIcon />}
                <span className="truncate">{statusText(platform)}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {/* The button's own words change; this says the change aloud. */}
      <p role="status" className="sr-only">
        {buttons
          .filter((platform) => status[platform] !== 'idle')
          .map(statusText)
          .join(' ')}
      </p>
      {failure === null ? null : (
        <p
          role="alert"
          className="canvas-text mx-[2px] mt-[var(--space-2)] text-xs text-[var(--error)]"
        >
          {t(FAILURE_KEYS[failure.kind], { platform: t(PLATFORM_NAME_KEYS[failure.platform]) })}
        </p>
      )}
    </section>
  )
}
