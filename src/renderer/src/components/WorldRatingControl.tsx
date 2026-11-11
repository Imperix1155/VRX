import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SetWorldRatingFailure, WorldRating } from '@shared/worldRating'
import { readWorldRating, useWorldRatingAccount, writeWorldRating } from '../queries/worldRating'

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
  const canRead = typeof window !== 'undefined' && typeof window.vrx?.getWorldRating === 'function'
  const [shown, setShown] = useState<WorldRating>(null)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'saving'>(() =>
    accountId === null || !canRead ? 'idle' : 'loading'
  )
  const [loadError, setLoadError] = useState<SetWorldRatingFailure | null>(null)
  const [writeError, setWriteError] = useState<SetWorldRatingFailure | null>(null)
  const [tracked, setTracked] = useState({ accountId, worldRef })
  const generation = useRef(0)
  const seen = useRef({ accountId, worldRef })
  const bridge = typeof window !== 'undefined' && typeof window.vrx?.setWorldRating === 'function'
  const disabled = accountId === null || phase !== 'ready' || !bridge
  if (tracked.accountId !== accountId || tracked.worldRef !== worldRef) {
    setTracked({ accountId, worldRef })
    setShown(null)
    setLoadError(null)
    setWriteError(null)
    setPhase(accountId === null || !canRead ? 'idle' : 'loading')
  }

  useLayoutEffect(() => {
    if (seen.current.accountId === accountId && seen.current.worldRef === worldRef) return
    seen.current = { accountId, worldRef }
    generation.current += 1
  }, [accountId, worldRef])

  useEffect(() => {
    if (accountId === null || !canRead) return
    const token = generation.current
    void readWorldRating(accountId, worldRef).then((result) => {
      if (generation.current !== token) return
      if (result.ok) {
        setShown(result.value)
        setLoadError(null)
      } else if (result.reason !== 'stale') {
        setLoadError(result.reason)
      }
      setPhase('ready')
    })
  }, [accountId, canRead, worldRef])

  useEffect(() => {
    if (writeError === null) return
    const timer = window.setTimeout(() => setWriteError(null), WORLD_RATING_ERROR_MS)
    return () => window.clearTimeout(timer)
  }, [writeError])

  function press(choice: 'like' | 'dislike'): void {
    if (disabled || accountId === null) return
    const requestAccount = accountId
    const token = generation.current
    const previous = shown
    const next: WorldRating = shown === choice ? null : choice
    setShown(next)
    setPhase('saving')
    setWriteError(null)
    void writeWorldRating(requestAccount, worldRef, next).then((result) => {
      if (generation.current !== token) return
      if (result.ok) {
        setShown(result.value)
        setLoadError(null)
      } else {
        setShown(previous)
        setWriteError(result.reason)
      }
      setPhase('ready')
    })
  }

  const hint =
    accountId === null
      ? t('explore.rating.signedOut')
      : phase === 'loading'
        ? t('explore.rating.loading')
        : phase === 'saving'
          ? t('explore.rating.saving')
          : null
  const alert = writeError ?? loadError

  return (
    <div>
      <div
        role="group"
        aria-label={t('explore.rating.group')}
        className="flex flex-wrap gap-[var(--space-2)]"
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
      {hint ? <p className="mt-[var(--space-1)] text-xs text-[var(--text-dim)]">{hint}</p> : null}
      {alert ? (
        <p role="alert" className="mt-[var(--space-1)] text-xs text-[var(--error)]">
          {t(FAILURE_KEYS[alert])}
        </p>
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
