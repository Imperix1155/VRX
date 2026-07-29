import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Platform, TwoFactorMethod } from '@shared/types'
import { useAuthFlow } from '../hooks/useAuthFlow'
import { ACCOUNT_CARD_CONFIG } from '../utils/accountCard'
import SegmentedControl from './SegmentedControl'
import CredentialsForm from './auth/CredentialsForm'
import TwoFactorForm from './auth/TwoFactorForm'
import { loginCopy } from './auth/copy'

/**
 * Two-tab login screen (VRX-217): VRChat | ChilloutVR above ONE shared
 * credentials/2FA form (the `useAuthFlow` machine + auth components, VRX-221).
 * A CVR-only user can sign in here — previously LoginScreen hardcoded VRChat.
 *
 * Tab control: the shared segmented radiogroup (roving tabindex, measured
 * sliding bubble) with the platform color on the WORD per the §9.1 filter
 * precedent — the tab words are the R12 non-color signifier, never a filled
 * color block. VRChat is preselected; the §8 center-neutral rule is silent for
 * a pure two-platform enum (no "both" option exists).
 *
 * `initialTwoFactor` (VRX-173) is a VRChat-only reprompt: the auth gate passes
 * the method when the VRChat session only needs a fresh second factor — the
 * VRChat tab then opens DIRECTLY on the method-aware code prompt (no password
 * re-entry; Back remains the escape hatch to a full credentials login).
 *
 * Switching tabs REMOUNTS the form (key={platform}): a fresh form for that
 * platform — no typed username/password/code/error ever carries across account
 * systems (CVR's "username" is an email).
 */

// Display order: VRChat | ChilloutVR.
const LOGIN_PLATFORMS: readonly Platform[] = ['vrchat', 'chilloutvr']

const PLATFORM_TAB_LABEL_KEYS: Record<Platform, string> = {
  vrchat: 'settings.accounts.vrchat.label',
  chilloutvr: 'settings.accounts.chilloutvr.label'
}

// Platform color on the WORD (§9.1), via the AA-verified login-tab tokens
// (raw --vrc fails contrast on the tinted card in both themes; raw --cvr
// fails in light — see the --login-tab-* block in main.css for the numbers).
const PLATFORM_TAB_TEXT_COLORS: Record<Platform, string> = {
  vrchat: 'var(--login-tab-vrc)',
  chilloutvr: 'var(--login-tab-cvr)'
}

// Solid platform submit button (the login screen's existing recipe, extended
// per platform). Full literals only — Tailwind never sees interpolated classes.
const PLATFORM_SUBMIT_CLASS: Record<Platform, string> = {
  vrchat: 'border-[var(--vrc)] bg-[var(--vrc)] text-[var(--text-on-vrc)]',
  // White on --cvr fails AA (2.92:1 dark / 3.77:1 light) — dark ink instead.
  chilloutvr: 'border-[var(--cvr)] bg-[var(--cvr)] text-[var(--text-on-cvr)]'
}
const SUBMIT_BASE_CLASS =
  'rounded-control border px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold hover:opacity-90 disabled:opacity-50 motion-safe:transition-opacity'

function PlatformLoginForm({
  platform,
  initialTwoFactor = null,
  onSubmittingChange
}: {
  platform: Platform
  initialTwoFactor?: TwoFactorMethod | null
  /** Lifts the flow's pending state so the screen can lock the platform tabs. */
  onSubmittingChange: (isSubmitting: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const config = ACCOUNT_CARD_CONFIG[platform]
  const flow = useAuthFlow(platform, {
    genericErrorKey: 'login.error.unknown',
    // The needs-2fa reprompt seed is VRChat-only (CVR has no 2FA — a stray
    // needs2fa there falls back to the generic error inside the hook).
    initialTwoFactor: platform === 'vrchat' ? initialTwoFactor : null
  })
  // Lock the tabs while the login/verify IPC is in flight: a tab switch would
  // remount this form and strand the late result in the unmounted hook (and
  // enabled tabs would allow two platform logins to run concurrently).
  useEffect(() => {
    onSubmittingChange(flow.isSubmitting)
  }, [flow.isSubmitting, onSubmittingChange])

  const formAriaLabel = t('login.formAria', { platform: t(config.labelKey) })
  const submitClassName = `${SUBMIT_BASE_CLASS} ${PLATFORM_SUBMIT_CLASS[platform]}`

  return flow.pending2fa === null ? (
    <CredentialsForm
      // Per-platform IDs + autocomplete sections partition password-manager
      // autofill — the two tab forms must never cross-fill credentials.
      idPrefix={`login-${platform}`}
      autocompleteSection={platform}
      copy={loginCopy(platform)}
      username={flow.username}
      password={flow.password}
      isSubmitting={flow.isSubmitting}
      errorKey={flow.errorKey}
      onUsernameChange={flow.setUsername}
      onPasswordChange={flow.setPassword}
      onSubmit={(e) => void flow.handleSubmit(e)}
      inputFocusClass={config.focusClass}
      submitClassName={`mt-[var(--space-1)] ${submitClassName}`}
      ariaLabel={formAriaLabel}
    />
  ) : (
    <TwoFactorForm
      idPrefix="login"
      copy={loginCopy(platform)}
      method={flow.pending2fa}
      code={flow.twoFactorCode}
      isSubmitting={flow.isSubmitting}
      errorKey={flow.errorKey}
      onCodeChange={flow.setTwoFactorCode}
      onSubmit={(e) => void flow.handleSubmit(e)}
      onBack={flow.handleBack}
      inputFocusClass={config.focusClass}
      submitClassName={submitClassName}
      promptClassName="mb-[var(--space-1)]"
      ariaLabel={formAriaLabel}
    />
  )
}

export default function LoginScreen({
  initialTwoFactor = null
}: {
  initialTwoFactor?: TwoFactorMethod | null
}): React.JSX.Element {
  const { t } = useTranslation()
  // VRChat preselected — also the reprompt tab (initialTwoFactor is VRChat-only).
  const [platform, setPlatform] = useState<Platform>('vrchat')
  // Lifted from the active form: true while its login/verify IPC is in flight.
  const [isSubmitting, setIsSubmitting] = useState(false)
  const config = ACCOUNT_CARD_CONFIG[platform]

  return (
    /* Full-screen centered layout */
    <div className="flex min-h-screen items-center justify-center px-[var(--space-4)] py-[var(--space-10)]">
      {/*
        Glass card with the active platform's tint (DESIGN.md §3 / §3A).
        .glass and .tint-vrc/.tint-cvr classes are defined in main.css; all rgba
        values live in :root / [data-theme="light"] token blocks so light-mode
        parity is automatic.
      */}
      <div
        className={`glass ${config.tintClass} relative w-full max-w-sm overflow-hidden p-[var(--space-8)]`}
      >
        {/*
          The .glass::before sheen is defined in CSS.
          This wrapper isolates content above the ::before pseudo-element.
        */}
        <div className="relative">
          {/* Brand mark (DESIGN.md §1: per-letter spans, VT323, platform colors) */}
          <div className="mb-[var(--space-6)] text-center">
            <div
              className="inline-block font-mono text-4xl leading-none tracking-wider"
              aria-label="VRX"
            >
              <span style={{ color: 'var(--vrc)' }}>V</span>
              <span style={{ color: 'var(--bridge)' }}>R</span>
              <span style={{ color: 'var(--cvr)' }}>X</span>
            </div>
            <p className="mt-[var(--space-1)] text-xs text-[var(--text-faint)]">
              {t('login.subtitle')}
            </p>
          </div>

          {/* Platform tabs — radiogroup + roving tabindex (the house pattern) */}
          <div className="mb-[var(--space-6)]">
            <SegmentedControl
              values={LOGIN_PLATFORMS}
              active={platform}
              labelKeys={PLATFORM_TAB_LABEL_KEYS}
              textColors={PLATFORM_TAB_TEXT_COLORS}
              ariaLabel={t('login.tabs.aria')}
              onChange={setPlatform}
              disabled={isSubmitting}
            />
          </div>

          {/* key: switching tabs = a fresh form for that platform — nothing typed
              (not even the username) carries across account systems. */}
          <PlatformLoginForm
            key={platform}
            platform={platform}
            initialTwoFactor={initialTwoFactor}
            onSubmittingChange={setIsSubmitting}
          />

          <p className="mt-[var(--space-6)] text-center text-xs text-[var(--text-faint)]">
            {t(platform === 'vrchat' ? 'login.disclaimer' : 'login.disclaimerChilloutvr')}
          </p>
        </div>
      </div>
    </div>
  )
}
