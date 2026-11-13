import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SetWorldRatingFailure, WorldRating } from '@shared/worldRating'
import {
  readWorldRating,
  useWorldRatingAccount,
  useWorldRatingPending,
  useWorldRatingValue,
  writeWorldRating
} from '../queries/worldRating'

/** A failed press says so, then the line goes away on its own. */
export const WORLD_RATING_ERROR_MS = 8_000

const FAILURE_KEYS: Readonly<Record<SetWorldRatingFailure, string>> = {
  cooldown: 'explore.rating.failed.cooldown',
  'rate-limited': 'explore.rating.failed.rate-limited',
  failed: 'explore.rating.failed.failed',
  'not-authenticated': 'explore.rating.failed.not-authenticated',
  'unknown-world': 'explore.rating.failed.unknown-world',
  stale: 'explore.rating.failed.stale',
  'not-vrchat': 'explore.rating.failed.not-vrchat'
}

const BUTTON =
  'inline-flex items-center gap-[var(--space-1)] rounded-[10px] border px-[var(--space-3)] py-[var(--space-1)] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] disabled:cursor-default disabled:text-[var(--text-faint)]'

function Thumb({ down }: { down?: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`h-[14px] w-[14px] flex-none ${down ? 'rotate-180' : ''}`}
    >
      <path d="M8 10v9H5.5A1.5 1.5 0 0 1 4 17.5v-6A1.5 1.5 0 0 1 5.5 10H8Z" />
      <path d="M8 10.5 11.2 4.6A1.8 1.8 0 0 1 14.4 6l-.7 4H18a2 2 0 0 1 2 2.3l-.8 5.2A2 2 0 0 1 17.2 19H8" />
    </svg>
  )
}

export interface WorldRatingControlProps {
  /** Main's Explore reference. The only world identity sent to main. */
  worldRef: string
  worldName: string
}

/**
 * Like and Dislike for the signed-in user's own VRChat rating. Hidden for
 * ChilloutVR, which has no world rating. Pressing the active choice clears it.
 */
export default function WorldRatingControl({
  worldRef,
  worldName
}: WorldRatingControlProps): React.JSX.Element {
  const { t } = useTranslation()
  const accountId = useWorldRatingAccount()
  const shown = useWorldRatingValue(accountId, worldRef)
  const pending = useWorldRatingPending(accountId, worldRef)
  const canRead = typeof window !== 'undefined' && typeof window.vrx?.getWorldRating === 'function'
  const bridge = typeof window !== 'undefined' && typeof window.vrx?.setWorldRating === 'function'
  const [loadError, setLoadError] = useState<SetWorldRatingFailure | null>(null)
  // True once the read for this account and world has answered, either way.
  const [readOver, setReadOver] = useState(false)
  const [writeError, setWriteError] = useState<SetWorldRatingFailure | null>(null)
  const [tracked, setTracked] = useState({ accountId, worldRef })
  // Bumped by "Try again", so the read below runs once more.
  const [attempt, setAttempt] = useState(0)
  const reads = useRef(0)
  const request = useRef(0)
  const group = useRef<HTMLDivElement>(null)
  // "Loading" is only ever a read that is still out. A read that is over
  // with no rating to show has failed, whatever the cause: the line under
  // the buttons says so and offers "Try again". Never infer "loading" from a
  // missing rating alone, or the buttons can stay off with nothing on its way.
  const readProblem: SetWorldRatingFailure | null =
    shown === undefined && !pending && readOver ? (loadError ?? 'failed') : null
  // Reading again can only help when the platform did not answer or asked
  // for a pause. Signing in again or refreshing the world is another step.
  const canRetryRead =
    accountId !== null && (readProblem === 'failed' || readProblem === 'rate-limited')
  const loading = accountId !== null && canRead && shown === undefined && !pending && !readOver
  const disabled = accountId === null || pending || loading || shown === undefined || !bridge
  if (tracked.accountId !== accountId || tracked.worldRef !== worldRef) {
    setTracked({ accountId, worldRef })
    setLoadError(null)
    setReadOver(false)
    setWriteError(null)
  }

  useEffect(() => {
    const token = ++reads.current
    if (accountId === null || !canRead) return
    void readWorldRating(accountId, worldRef).then((result) => {
      if (reads.current !== token) return
      setReadOver(true)
      // `stale` (the request was dropped on the way) ends the read like any
      // other failure. A real account change resets this line above.
      setLoadError(result.ok ? null : result.reason === 'stale' ? 'failed' : result.reason)
    })
  }, [accountId, canRead, worldRef, attempt])

  useEffect(() => {
    if (writeError === null) return
    const timer = window.setTimeout(() => setWriteError(null), WORLD_RATING_ERROR_MS)
    return () => window.clearTimeout(timer)
  }, [writeError])

  function press(choice: 'like' | 'dislike'): void {
    if (disabled || accountId === null || shown === undefined) return
    const token = ++request.current
    const next: WorldRating = shown === choice ? null : choice
    setWriteError(null)
    void writeWorldRating(accountId, worldRef, next).then((result) => {
      if (request.current !== token || result.ok) return
      setWriteError(result.reason)
    })
  }

  /** One press, one new read. The button leaves the line while it runs. */
  function retryRead(): void {
    setLoadError(null)
    setReadOver(false)
    setAttempt((count) => count + 1)
    // "Try again" leaves the screen while the read runs. Keyboard focus moves
    // to the two choices, so it is not dropped to the page behind the sheet.
    group.current?.focus({ preventScroll: true })
  }

  const hint =
    accountId === null
      ? t('explore.rating.signedOut')
      : loading
        ? t('explore.rating.loading')
        : pending
          ? t('explore.rating.saving')
          : null
  // A rating that did arrive (another open sheet read it) outdates the
  // failed read, so its line goes away.
  const alertText =
    writeError !== null
      ? t(FAILURE_KEYS[writeError])
      : readProblem === 'failed'
        ? t('explore.rating.loadFailed')
        : readProblem !== null
          ? t(FAILURE_KEYS[readProblem])
          : null

  return (
    <div>
      <div
        ref={group}
        tabIndex={-1}
        role="group"
        aria-label={t('explore.rating.group')}
        className="flex flex-wrap gap-[var(--space-2)] focus:outline-none"
      >
        <RateButton
          label={shown === 'like' ? t('explore.rating.liked') : t('explore.rating.like')}
          pressed={shown === 'like'}
          disabled={disabled}
          ariaLabel={
            shown === 'like'
              ? t('explore.rating.likedAria', { world: worldName })
              : t('explore.rating.likeAria', { world: worldName })
          }
          onClick={() => press('like')}
        >
          <Thumb />
        </RateButton>
        <RateButton
          label={shown === 'dislike' ? t('explore.rating.disliked') : t('explore.rating.dislike')}
          pressed={shown === 'dislike'}
          disabled={disabled}
          ariaLabel={
            shown === 'dislike'
              ? t('explore.rating.dislikedAria', { world: worldName })
              : t('explore.rating.dislikeAria', { world: worldName })
          }
          onClick={() => press('dislike')}
        >
          <Thumb down />
        </RateButton>
      </div>
      {hint ? (
        // "Loading" and "Saving" are announced. The signed-out line is plain
        // text: it does not change while the sheet is open.
        <p
          role={accountId === null ? undefined : 'status'}
          className="mt-[var(--space-1)] text-xs text-[var(--text-dim)]"
        >
          {hint}
        </p>
      ) : null}
      {alertText ? (
        // The error and its "Try again" share one line and wrap when narrow.
        <div className="mt-[var(--space-1)] flex flex-wrap items-center gap-x-[var(--space-1)]">
          <p role="alert" className="text-xs text-[var(--error)]">
            {alertText}
          </p>
          {canRetryRead ? (
            <button
              type="button"
              onClick={retryRead}
              className="rounded-control px-[var(--space-2)] py-[var(--space-1)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-hover)] motion-safe:transition-colors"
            >
              {t('explore.rating.retry')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function RateButton({
  label,
  pressed,
  disabled,
  ariaLabel,
  onClick,
  children
}: {
  label: string
  pressed: boolean
  disabled: boolean
  ariaLabel: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`${BUTTON} ${
        pressed
          ? 'border-[var(--text)] bg-[var(--control-fill-hover)] text-[var(--text)]'
          : 'border-[var(--border)] bg-[var(--control-fill)] text-[var(--text)] hover:bg-[var(--control-fill-hover)]'
      }`}
    >
      {children}
      {label}
    </button>
  )
}
