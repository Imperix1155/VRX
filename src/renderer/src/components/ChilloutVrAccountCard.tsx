import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { authStatusQueryKey, useAuthStatus } from '../queries/auth'
import { friendsQueryKey } from '../queries/friends'
import PlatformGlyph from './PlatformGlyph'

/**
 * ChilloutVR account row for Settings → Accounts (VRX-37). Platform-tinted per
 * DESIGN.md §5 (CVR orange carried by tint + glyph only, never decoration):
 * `.tint-cvr` glass card + the `C` PlatformGlyph.
 *
 * Two states, driven by `useAuthStatus('chilloutvr')`:
 * - authenticated: display name + a disabled "coming soon" Disconnect button
 *   (VRX-89 owns the real disconnect flow).
 * - otherwise: an email+password form that calls the EXISTING login IPC with
 *   `platform: 'chilloutvr'`. CVR has no 2FA leg (DESIGN.md §5/§6: never
 *   fabricate a CVR equivalent) — a `needs2fa` result is unexpected here and
 *   surfaces the generic error. On success, invalidates the CVR auth-status
 *   and friends queries so the UI picks up the new session.
 */
export default function ChilloutVrAccountCard(): React.JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: authStatus } = useAuthStatus('chilloutvr')

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setErrorKey(null)

    if (!window.vrx) {
      setErrorKey('settings.accounts.chilloutvr.error.unknown')
      return
    }

    setIsSubmitting(true)

    try {
      const result = await window.vrx.login({
        platform: 'chilloutvr',
        credentials: { username, password }
      })

      if (result.ok) {
        void queryClient.invalidateQueries({ queryKey: authStatusQueryKey('chilloutvr') })
        void queryClient.invalidateQueries({ queryKey: friendsQueryKey('chilloutvr') })
      } else if (result.needs2fa) {
        // CVR has no 2FA leg — this shouldn't happen; surface the generic error
        // rather than fabricating a CVR 2FA flow (DESIGN.md §5/§6).
        setErrorKey('settings.accounts.chilloutvr.error.unknown')
      } else if (result.error === 'invalid_credentials') {
        setErrorKey('settings.accounts.chilloutvr.error.invalidCredentials')
      } else if (result.error === 'network_error') {
        setErrorKey('settings.accounts.chilloutvr.error.networkError')
      } else {
        setErrorKey('settings.accounts.chilloutvr.error.unknown')
      }
    } catch {
      setErrorKey('settings.accounts.chilloutvr.error.unknown')
    } finally {
      // Never store/log the password — clear it after every attempt.
      setPassword('')
      setIsSubmitting(false)
    }
  }

  const isConnected = authStatus?.state === 'authenticated'

  return (
    <div className="glass tint-cvr relative overflow-hidden p-[var(--space-6)]">
      <div className="relative flex items-center gap-[var(--space-3)]">
        <PlatformGlyph platform="chilloutvr" />
        <p className="text-sm font-medium text-[var(--text)]">
          {t('settings.accounts.chilloutvr.label')}
        </p>
      </div>

      {isConnected ? (
        <div className="relative mt-[var(--space-4)] flex items-center justify-between gap-[var(--space-6)]">
          <p className="text-sm text-[var(--text-dim)]">
            {t('settings.accounts.chilloutvr.connectedAs', { name: authStatus.displayName })}
          </p>
          <button
            type="button"
            disabled
            title={t('settings.accounts.chilloutvr.disconnectTitle')}
            className="rounded-control border border-[var(--border)] px-[var(--space-4)] py-[var(--space-2)] text-sm text-[var(--text-dim)] opacity-50"
          >
            {t('settings.accounts.chilloutvr.disconnect')}
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          noValidate
          className="relative mt-[var(--space-4)]"
        >
          <div className="flex flex-col gap-[var(--space-3)]">
            <div>
              <label
                htmlFor="cvr-username"
                className="mb-[var(--space-1)] block text-xs text-[var(--text-dim)]"
              >
                {t('settings.accounts.chilloutvr.username')}
              </label>
              <input
                id="cvr-username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isSubmitting}
                className="w-full rounded-control border border-[var(--border)] bg-[var(--control-fill)] px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] hover:bg-[var(--control-fill-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--cvr)] disabled:opacity-50 motion-safe:transition-colors"
                placeholder={t('settings.accounts.chilloutvr.usernamePlaceholder')}
              />
            </div>

            <div>
              <label
                htmlFor="cvr-password"
                className="mb-[var(--space-1)] block text-xs text-[var(--text-dim)]"
              >
                {t('settings.accounts.chilloutvr.password')}
              </label>
              <input
                id="cvr-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSubmitting}
                className="w-full rounded-control border border-[var(--border)] bg-[var(--control-fill)] px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] hover:bg-[var(--control-fill-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--cvr)] disabled:opacity-50 motion-safe:transition-colors"
                placeholder={t('settings.accounts.chilloutvr.passwordPlaceholder')}
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
              className="mt-[var(--space-1)] self-start rounded-control border border-[var(--cvr)] bg-[color-mix(in_srgb,var(--cvr)_16%,transparent)] px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold text-[var(--cvr)] hover:opacity-90 disabled:opacity-50 motion-safe:transition-opacity"
            >
              {isSubmitting
                ? t('settings.accounts.chilloutvr.connecting')
                : t('settings.accounts.chilloutvr.connect')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
