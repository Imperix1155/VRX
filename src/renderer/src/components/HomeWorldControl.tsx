import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SetHomeWorldFailure } from '@shared/homeWorld'
import type { Platform } from '@shared/types'
import { setHomeWorld, useHomeWorldAccount, useHomeWorldId } from '../queries/homeWorld'

const FAILURE_KEYS: Readonly<Record<SetHomeWorldFailure, string>> = {
  cooldown: 'explore.home.failed.cooldown',
  'rate-limited': 'explore.home.failed.rate-limited',
  failed: 'explore.home.failed.failed',
  'not-authenticated': 'explore.home.failed.not-authenticated',
  'unknown-world': 'explore.home.failed.unknown-world'
}

type Step =
  | { state: 'idle' }
  | { state: 'confirm' }
  | { state: 'pending' }
  | { state: 'done' }
  | { state: 'failed'; reason: SetHomeWorldFailure }

/** A small house: the same 1.8 stroke as the navigation icons. */
function IconHome(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-[14px] w-[14px] flex-none"
    >
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9v10.5h12V9" />
      <path d="M10 19.5v-5h4v5" />
    </svg>
  )
}

const BUTTON =
  'inline-flex items-center gap-[var(--space-1)] rounded-[10px] border border-[var(--border)] bg-[var(--control-fill)] px-[var(--space-3)] py-[var(--space-1)] text-xs font-semibold text-[var(--text)] hover:bg-[var(--control-fill-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] disabled:cursor-default disabled:text-[var(--text-faint)]'

export interface HomeWorldControlProps {
  platform: Platform
  /** Main's Explore reference for the world; the only thing sent to main. */
  worldRef: string
  worldId: string
  worldName: string
  /** Shown first on the same line (the platform pill). */
  leading: React.ReactNode
}

/**
 * "Set as home world" for a world sheet. A press asks once ("It replaces the
 * one you have now"), then sends one write through main. After a success the
 * sheet says "Your home world" for the rest of the session.
 */
export default function HomeWorldControl({
  platform,
  worldRef,
  worldId,
  worldName,
  leading
}: HomeWorldControlProps): React.JSX.Element {
  const { t } = useTranslation()
  const accountId = useHomeWorldAccount(platform)
  const homeId = useHomeWorldId(platform, accountId)
  const [step, setStep] = useState<Step>({ state: 'idle' })
  const confirmRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef(false)
  const platformName = t(platform === 'vrchat' ? 'dashboard.platformVrc' : 'dashboard.platformCvr')
  const isHome = homeId === worldId
  const pending = step.state === 'pending'

  useEffect(() => {
    if (step.state === 'confirm') confirmRef.current?.focus()
    if (step.state === 'idle' && returnFocusRef.current) {
      returnFocusRef.current = false
      openerRef.current?.focus()
    }
  }, [step.state])

  function cancel(): void {
    returnFocusRef.current = true
    setStep({ state: 'idle' })
  }

  function confirm(): void {
    if (accountId === null || pending) return
    setStep({ state: 'pending' })
    setHomeWorld({ platform, worldRef, accountId }).then(
      (result) =>
        setStep(result.ok ? { state: 'done' } : { state: 'failed', reason: result.reason }),
      (error: unknown) =>
        setStep({
          state: 'failed',
          reason:
            error instanceof Error && error.message === 'rate_limited' ? 'rate-limited' : 'failed'
        })
    )
  }

  const control =
    accountId === null ? null : isHome ? (
      <span
        className="inline-flex items-center gap-[var(--space-1)] rounded-[10px] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-1)] text-xs font-semibold text-[var(--text)]"
        aria-label={t('explore.home.isHomeAria', { world: worldName, platform: platformName })}
      >
        <IconHome />
        {t('explore.home.isHome')}
      </span>
    ) : step.state === 'confirm' || pending ? null : (
      <button
        ref={openerRef}
        type="button"
        onClick={() => setStep({ state: 'confirm' })}
        aria-label={t('explore.home.setAria', { world: worldName, platform: platformName })}
        className={BUTTON}
      >
        <IconHome />
        {t('explore.home.set')}
      </button>
    )

  return (
    <div>
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        {leading}
        {control}
      </div>
      {accountId !== null && !isHome && (step.state === 'confirm' || pending) ? (
        <div
          role="group"
          aria-label={t('explore.home.confirmAria', { world: worldName })}
          className="mt-[var(--space-2)] flex flex-wrap items-center gap-x-[var(--space-3)] gap-y-[var(--space-2)] rounded-[13px] border border-[var(--border)] bg-[var(--control-fill)] p-[var(--space-3)]"
        >
          <p className="min-w-0 flex-1 basis-[16rem] text-xs text-[var(--text)]">
            {t('explore.home.confirm', { platform: platformName })}
          </p>
          <div className="flex shrink-0 items-center gap-[var(--space-2)]">
            <button
              ref={confirmRef}
              type="button"
              onClick={confirm}
              disabled={pending}
              className={BUTTON}
            >
              <IconHome />
              {pending ? t('explore.home.setting') : t('explore.home.makeHome')}
            </button>
            <button type="button" onClick={cancel} disabled={pending} className={BUTTON}>
              {t('explore.home.cancel')}
            </button>
          </div>
        </div>
      ) : null}
      {accountId === null ? null : (
        <p
          role="status"
          className={`text-xs [&:not(:empty)]:mt-[var(--space-1)] ${
            step.state === 'failed' ? 'text-[var(--error)]' : 'text-[var(--text-dim)]'
          }`}
        >
          {step.state === 'done' && isHome
            ? t('explore.home.done', { platform: platformName })
            : step.state === 'failed'
              ? t(FAILURE_KEYS[step.reason], { platform: platformName })
              : ''}
        </p>
      )}
    </div>
  )
}
