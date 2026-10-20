import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStatus } from '../../queries/auth'
import { useSettingsStore } from '../../stores/settings'
import { useUiStore } from '../../stores/ui'
import {
  AlertsStep,
  DashboardStep,
  DoneStep,
  LookStep,
  PagesStep,
  SignInStep,
  WelcomeStep
} from './SetupSteps'
import { isAccountReady, SECONDARY_BUTTON } from './setupModel'

/**
 * First-run welcome setup (owner, 2026-10-20: concept A, the welcome wizard).
 * One card walks through sign-in and the key settings. It is never a forced
 * tour: "Skip setup" is a real button on every screen. VRX needs one account
 * to show anything, so skipping before sign-in goes to the sign-in step only,
 * then straight in with the defaults. Every step writes real settings as you
 * pick, so leaving early keeps what was already chosen.
 */

const STEPS = ['welcome', 'signin', 'pages', 'dashboard', 'alerts', 'look', 'done'] as const
type SetupStep = (typeof STEPS)[number]

/** The labeled middle steps the progress bar counts. */
const COUNTED: readonly SetupStep[] = ['signin', 'pages', 'dashboard', 'alerts', 'look']
const STEP_LABEL_KEYS: Partial<Record<SetupStep, string>> = {
  signin: 'setup.steps.signin',
  pages: 'setup.steps.pages',
  dashboard: 'setup.steps.dashboard',
  alerts: 'setup.steps.alerts',
  look: 'setup.steps.look'
}

const PRIMARY_BUTTON =
  'rounded-control border border-[var(--text)] bg-[var(--text)] px-[18px] py-[10px] text-[13px] font-semibold leading-none text-[var(--bg-base)] hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-dim)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)] disabled:cursor-not-allowed disabled:opacity-40 motion-safe:transition-opacity cursor-pointer'

function CheckGlyph(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      aria-hidden="true"
      className="h-[12px] w-[12px] flex-none"
    >
      <path d="M5 12.5l4.2 4.2L19 7" />
    </svg>
  )
}

/** Position, weight and a check carry each step's state, never color alone. */
function Progress({
  step,
  onJump
}: {
  step: SetupStep
  onJump: (step: SetupStep) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const index = COUNTED.indexOf(step)
  if (index < 0) return null
  return (
    <nav aria-label={t('setup.progress.aria')} className="mb-[var(--space-4)]">
      <p className="mb-[8px] text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">
        {t('setup.progress.count', { current: index + 1, total: COUNTED.length })}
      </p>
      <ol className="grid grid-cols-5 gap-[6px]">
        {COUNTED.map((id, i) => {
          const state = i < index ? 'done' : i === index ? 'current' : 'todo'
          const label = t(STEP_LABEL_KEYS[id] ?? '')
          return (
            <li key={id}>
              <button
                type="button"
                // Finished steps can be revisited; later ones open in order.
                disabled={i > index}
                aria-current={state === 'current' ? 'step' : undefined}
                aria-label={
                  state === 'done' ? t('setup.progress.done', { step: label }) : undefined
                }
                onClick={() => onJump(id)}
                data-state={state}
                className="setup-progress-step"
              >
                <span className="setup-progress-bar" aria-hidden="true" />
                <span className="inline-flex items-center gap-[3px]">
                  {state === 'done' && <CheckGlyph />}
                  {label}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export default function SetupWizard(): React.JSX.Element {
  const { t } = useTranslation()
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const { data: vrcStatus } = useAuthStatus('vrchat')
  const { data: cvrStatus } = useAuthStatus('chilloutvr')
  const [step, setStep] = useState<SetupStep>('welcome')
  // "Skip setup" pressed before any account was ready: sign in, then go in.
  const [skipping, setSkipping] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const firstStep = useRef(true)

  const authStates = { vrchat: vrcStatus?.state, chilloutvr: cvrStatus?.state }
  const readyCount = [vrcStatus?.state, cvrStatus?.state].filter(isAccountReady).length
  const anyReady = readyCount > 0

  // Announce each new step: focus its heading (not on the first render, so
  // the window opens without a focus ring).
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false
      return
    }
    headingRef.current?.focus()
  }, [step, skipping])

  const finish = (): void => {
    useUiStore.getState().setActiveTab('dashboard')
    updateSettings({ setupPending: false })
  }

  const skip = (): void => {
    if (anyReady) {
      finish()
      return
    }
    setSkipping(true)
    setStep('signin')
  }

  const index = STEPS.indexOf(step)
  const next = (): void => {
    if (step === 'done' || (skipping && step === 'signin')) {
      finish()
      return
    }
    const following = STEPS[index + 1]
    if (following) setStep(following)
  }
  const back = (): void => {
    if (skipping) {
      setSkipping(false)
      setStep('welcome')
      return
    }
    const previous = STEPS[index - 1]
    if (previous) setStep(previous)
  }

  const primaryLabel =
    step === 'welcome'
      ? t('setup.getStarted')
      : step === 'done' || skipping
        ? t('setup.finish')
        : t('setup.continue')
  const primaryDisabled = step === 'signin' && !anyReady
  const showSkip = step !== 'done' && !skipping

  return (
    <div className="flex min-h-screen items-center justify-center p-[var(--space-4)]">
      <section
        aria-labelledby="setup-step-title"
        className="glass glass-information relative flex h-[min(620px,calc(100vh-32px))] w-full max-w-[640px] flex-col overflow-hidden px-[30px] pb-[22px] pt-[26px]"
      >
        <div className="relative flex min-h-0 flex-1 flex-col">
          {!skipping && <Progress step={step} onJump={setStep} />}
          {/* Keyed so each step enters fresh (and replays the enter motion). */}
          <div
            key={step}
            className="setup-step -mx-[30px] min-h-0 flex-1 overflow-y-auto px-[30px]"
          >
            {step === 'welcome' && <WelcomeStep ref={headingRef} />}
            {step === 'signin' && (
              <SignInStep ref={headingRef} skipping={skipping} readyCount={readyCount} />
            )}
            {step === 'pages' && <PagesStep ref={headingRef} />}
            {step === 'dashboard' && <DashboardStep ref={headingRef} />}
            {step === 'alerts' && <AlertsStep ref={headingRef} />}
            {step === 'look' && <LookStep ref={headingRef} />}
            {step === 'done' && <DoneStep ref={headingRef} authStates={authStates} />}
          </div>
          <div className="mt-[var(--space-4)] flex items-center justify-between gap-[var(--space-3)] border-t border-[var(--border)] pt-[var(--space-4)]">
            {showSkip ? (
              <button type="button" className={SECONDARY_BUTTON} onClick={skip}>
                {t('setup.skip')}
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-[var(--space-2)]">
              {index > 0 && (
                <button type="button" className={SECONDARY_BUTTON} onClick={back}>
                  {t('setup.back')}
                </button>
              )}
              <button
                type="button"
                className={PRIMARY_BUTTON}
                disabled={primaryDisabled}
                onClick={next}
              >
                {primaryLabel}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
