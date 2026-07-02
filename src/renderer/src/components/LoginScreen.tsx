import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import type { TwoFactorMethod } from '@shared/types'
import { authStatusQueryKey } from '../queries/auth'
import { mapLoginError } from '../utils/loginError'

/**
 * VRChat login screen (VRX-158).
 *
 * Flow: credentials → login() → on needs2fa → 2FA code prompt → login() with code.
 * The password is held in component state only for the 2FA retry; it is never logged.
 */
export default function LoginScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [pending2fa, setPending2fa] = useState<TwoFactorMethod | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setErrorKey(null)

    if (!window.vrx) {
      setErrorKey('login.error.unknown')
      return
    }

    setIsSubmitting(true)

    try {
      // Second leg authenticates via the session cookie from the first login, so
      // no credentials are resent — the password is dropped once 2FA is requested.
      const result = pending2fa
        ? await window.vrx.verify2fa({ platform: 'vrchat', code: twoFactorCode })
        : await window.vrx.login({ platform: 'vrchat', credentials: { username, password } })

      if (result.ok) {
        // Invalidate so the auth gate re-checks and transitions to the app.
        void queryClient.invalidateQueries({ queryKey: authStatusQueryKey })
      } else if (result.needs2fa) {
        setPending2fa(result.method)
        setPassword('') // drop the secret — the 2FA leg authenticates via the cookie
        setTwoFactorCode('')
      } else {
        setErrorKey(mapLoginError(result.error))
      }
    } catch {
      // Bridge/IPC failure (e.g. the main handler threw) — surface it instead of
      // silently re-enabling the button with no feedback.
      setErrorKey('login.error.unknown')
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleBack(): void {
    setPending2fa(null)
    setTwoFactorCode('')
    setErrorKey(null)
  }

  const twoFactorPromptKey =
    pending2fa === 'totp' ? 'login.twoFactor.promptTotp' : 'login.twoFactor.promptEmail'

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

          {!pending2fa ? (
            /* ── Credentials form ── */
            <form onSubmit={(e) => void handleSubmit(e)} noValidate>
              <div className="flex flex-col gap-[var(--space-3)]">
                <div>
                  <label
                    htmlFor="login-username"
                    className="mb-[var(--space-1)] block text-xs text-[var(--text-dim)]"
                  >
                    {t('login.username')}
                  </label>
                  <input
                    id="login-username"
                    type="text"
                    autoComplete="username"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={isSubmitting}
                    className="w-full rounded-control border border-[var(--border)] bg-[var(--control-fill)] px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] hover:bg-[var(--control-fill-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--vrc)] disabled:opacity-50 motion-safe:transition-colors"
                    placeholder={t('login.usernamePlaceholder')}
                  />
                </div>

                <div>
                  <label
                    htmlFor="login-password"
                    className="mb-[var(--space-1)] block text-xs text-[var(--text-dim)]"
                  >
                    {t('login.password')}
                  </label>
                  <input
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isSubmitting}
                    className="w-full rounded-control border border-[var(--border)] bg-[var(--control-fill)] px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] hover:bg-[var(--control-fill-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--vrc)] disabled:opacity-50 motion-safe:transition-colors"
                    placeholder={t('login.passwordPlaceholder')}
                  />
                </div>

                {errorKey && (
                  <p
                    className="flex items-center gap-[var(--space-2)] text-sm text-[var(--error)]"
                    role="alert"
                  >
                    {/* Non-color glyph (DESIGN.md R2/R10: color + glyph, never color alone) */}
                    <span aria-hidden="true">⚠</span>
                    {t(errorKey)}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting || !username || !password}
                  className="mt-[var(--space-1)] rounded-control border border-[var(--vrc)] bg-[var(--vrc)] px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold text-[var(--text-on-vrc)] hover:opacity-90 disabled:opacity-50 motion-safe:transition-opacity"
                >
                  {isSubmitting ? t('login.signingIn') : t('login.signIn')}
                </button>
              </div>
            </form>
          ) : (
            /* ── 2FA prompt ── */
            <form onSubmit={(e) => void handleSubmit(e)} noValidate>
              <p className="mb-[var(--space-4)] text-sm text-[var(--text-dim)]">
                {t(twoFactorPromptKey)}
              </p>

              <div className="flex flex-col gap-[var(--space-3)]">
                <div>
                  <label
                    htmlFor="login-2fa"
                    className="mb-[var(--space-1)] block text-xs text-[var(--text-dim)]"
                  >
                    {t('login.twoFactor.code')}
                  </label>
                  <input
                    id="login-2fa"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    value={twoFactorCode}
                    onChange={(e) => setTwoFactorCode(e.target.value)}
                    disabled={isSubmitting}
                    className="w-full rounded-control border border-[var(--border)] bg-[var(--control-fill)] px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] hover:bg-[var(--control-fill-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--vrc)] disabled:opacity-50 motion-safe:transition-colors"
                    placeholder={t('login.twoFactor.placeholder')}
                  />
                </div>

                {errorKey && (
                  <p
                    className="flex items-center gap-[var(--space-2)] text-sm text-[var(--error)]"
                    role="alert"
                  >
                    <span aria-hidden="true">⚠</span>
                    {t(errorKey)}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting || !twoFactorCode}
                  className="rounded-control border border-[var(--vrc)] bg-[var(--vrc)] px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold text-[var(--text-on-vrc)] hover:opacity-90 disabled:opacity-50 motion-safe:transition-opacity"
                >
                  {isSubmitting ? t('login.signingIn') : t('login.twoFactor.verify')}
                </button>

                <button
                  type="button"
                  onClick={handleBack}
                  disabled={isSubmitting}
                  className="rounded-control px-[var(--space-4)] py-[var(--space-2)] text-sm text-[var(--text-dim)] hover:bg-[var(--surface-hover)] disabled:opacity-50 motion-safe:transition-colors"
                >
                  {t('login.twoFactor.back')}
                </button>
              </div>
            </form>
          )}

          <p className="mt-[var(--space-6)] text-center text-xs text-[var(--text-faint)]">
            {t('login.disclaimer')}
          </p>
        </div>
      </div>
    </div>
  )
}
