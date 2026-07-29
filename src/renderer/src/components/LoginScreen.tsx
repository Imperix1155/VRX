import { useTranslation } from 'react-i18next'
import type { TwoFactorMethod } from '@shared/types'
import { useAuthFlow } from '../hooks/useAuthFlow'
import CredentialsForm from './auth/CredentialsForm'
import TwoFactorForm from './auth/TwoFactorForm'
import { LOGIN_COPY } from './auth/copy'

/** VRChat platform styling for the shared auth inputs/buttons. */
const FOCUS_CLASS = 'focus:ring-[var(--vrc)]'
const SUBMIT_CLASS =
  'rounded-control border border-[var(--vrc)] bg-[var(--vrc)] px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold text-[var(--text-on-vrc)] hover:opacity-90 disabled:opacity-50 motion-safe:transition-opacity'

/**
 * VRChat login screen (VRX-158).
 *
 * Flow: credentials → login() → on needs2fa → 2FA code prompt → verify2fa() for
 * the second leg — the state machine lives in `useAuthFlow` (VRX-221); this
 * component is the layout shell around the shared auth forms.
 *
 * `initialTwoFactor` (VRX-173): the auth gate passes the method when the session
 * only needs a fresh second factor (auth cookie alive, twoFactorAuth expired) —
 * the screen then opens directly on the code prompt; verify2fa authenticates via
 * the session cookie, so no password is asked for. Back remains the escape hatch
 * to a full credentials login.
 */
export default function LoginScreen({
  initialTwoFactor = null
}: {
  initialTwoFactor?: TwoFactorMethod | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const flow = useAuthFlow('vrchat', {
    genericErrorKey: 'login.error.unknown',
    initialTwoFactor
  })

  return (
    /* Full-screen centered layout */
    <div className="flex min-h-screen items-center justify-center px-[var(--space-4)] py-[var(--space-10)]">
      {/*
        Glass card with VRChat blue tint (DESIGN.md §3 / §3A).
        .glass and .tint-vrc classes are defined in main.css; all rgba values live in
        :root / [data-theme="light"] token blocks so light-mode parity is automatic.
      */}
      <div className="glass tint-vrc relative w-full max-w-sm overflow-hidden p-[var(--space-8)]">
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

          {flow.pending2fa === null ? (
            <CredentialsForm
              idPrefix="login"
              copy={LOGIN_COPY}
              username={flow.username}
              password={flow.password}
              isSubmitting={flow.isSubmitting}
              errorKey={flow.errorKey}
              onUsernameChange={flow.setUsername}
              onPasswordChange={flow.setPassword}
              onSubmit={(e) => void flow.handleSubmit(e)}
              inputFocusClass={FOCUS_CLASS}
              submitClassName={`mt-[var(--space-1)] ${SUBMIT_CLASS}`}
            />
          ) : (
            <TwoFactorForm
              idPrefix="login"
              copy={LOGIN_COPY}
              method={flow.pending2fa}
              code={flow.twoFactorCode}
              isSubmitting={flow.isSubmitting}
              errorKey={flow.errorKey}
              onCodeChange={flow.setTwoFactorCode}
              onSubmit={(e) => void flow.handleSubmit(e)}
              onBack={flow.handleBack}
              inputFocusClass={FOCUS_CLASS}
              submitClassName={SUBMIT_CLASS}
              promptClassName="mb-[var(--space-1)]"
            />
          )}

          <p className="mt-[var(--space-6)] text-center text-xs text-[var(--text-faint)]">
            {t('login.disclaimer')}
          </p>
        </div>
      </div>
    </div>
  )
}
