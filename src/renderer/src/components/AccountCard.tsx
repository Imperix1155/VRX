import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import type { Platform, TwoFactorMethod } from '@shared/types'
import { authStatusQueryKey, useAuthStatus } from '../queries/auth'
import { friendsQueryKey } from '../queries/friends'
import { ACCOUNT_CARD_CONFIG, accountLoginErrorKey } from '../utils/accountCard'

export default function AccountCard({ platform }: { platform: Platform }): React.JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: authStatus } = useAuthStatus(platform)
  const config = ACCOUNT_CARD_CONFIG[platform]

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [twoFactorOverride, setTwoFactorOverride] = useState<
    TwoFactorMethod | 'credentials' | null
  >(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)

  const authStatusTwoFactor =
    platform === 'vrchat' && authStatus?.state === 'needs-2fa'
      ? (authStatus.twoFactorMethod ?? 'totp')
      : null
  const pending2fa =
    twoFactorOverride === 'credentials' ? null : (twoFactorOverride ?? authStatusTwoFactor)

  async function refreshPlatformState(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: authStatusQueryKey(platform) }),
      queryClient.invalidateQueries({ queryKey: friendsQueryKey(platform) })
    ])
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setErrorKey(null)

    if (!window.vrx) {
      setErrorKey('settings.accounts.error.unknown')
      return
    }

    setIsSubmitting(true)
    try {
      const result = pending2fa
        ? await window.vrx.verify2fa({ platform: 'vrchat', code: twoFactorCode })
        : await window.vrx
            .login({ platform, credentials: { username, password } })
            .finally(() => setPassword(''))

      if (result.ok) {
        setTwoFactorOverride(null)
        setTwoFactorCode('')
        await refreshPlatformState()
      } else if (result.needs2fa && platform === 'vrchat') {
        setTwoFactorOverride(result.method)
        setPassword('')
        setTwoFactorCode('')
      } else if (result.needs2fa) {
        setErrorKey('settings.accounts.error.unknown')
      } else {
        setErrorKey(accountLoginErrorKey(platform, result.error))
      }
    } catch {
      setErrorKey('settings.accounts.error.unknown')
    } finally {
      setPassword('')
      setIsSubmitting(false)
    }
  }

  async function handleDisconnect(): Promise<void> {
    setErrorKey(null)
    if (!window.vrx) {
      setErrorKey('settings.accounts.error.unknown')
      return
    }

    setIsDisconnecting(true)
    try {
      await window.vrx.logout({ platform })
      // Settle auth FIRST (flips useFriends' enabled gate off), THEN drop the
      // platform's social data — removal wakes observers, and only a disabled
      // query is guaranteed not to refetch as unauthenticated. Logout means the
      // data must GO (a later login may be a different account), not refetch.
      await queryClient.invalidateQueries({ queryKey: authStatusQueryKey(platform) })
      queryClient.removeQueries({ queryKey: friendsQueryKey(platform) })
    } catch {
      setErrorKey('settings.accounts.error.disconnect')
    } finally {
      setIsDisconnecting(false)
    }
  }

  async function handleRetry(): Promise<void> {
    setErrorKey(null)
    setIsRetrying(true)
    try {
      // Refetch the auth status; on recovery the card settles back to its
      // connected (or unauthenticated) rendering by itself.
      await queryClient.invalidateQueries({ queryKey: authStatusQueryKey(platform) })
    } finally {
      setIsRetrying(false)
    }
  }

  function handleTwoFactorBack(): void {
    setTwoFactorOverride('credentials')
    setTwoFactorCode('')
    setErrorKey(null)
  }

  const isConnected = authStatus?.state === 'authenticated'
  // `error` = the platform couldn't be reached / its reply couldn't be read
  // (VRX-201) — the session may be alive, so NEVER show the Connect form here
  // (re-entering credentials would create a duplicate session). Quiet banner +
  // Retry + Sign out instead; identical path for both platforms.
  const isUnreachable = authStatus?.state === 'error'
  const inputClass = `w-full rounded-control border border-[var(--border)] bg-[var(--control-fill)] px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] hover:bg-[var(--control-fill-hover)] focus:outline-none focus:ring-1 ${config.focusClass} disabled:opacity-50 motion-safe:transition-colors`

  return (
    <div className={`glass ${config.tintClass} relative overflow-hidden p-[var(--space-6)]`}>
      <div className="relative flex items-center gap-[var(--space-3)]">
        {/* Reserved for a future real platform logo; do not restore PlatformGlyph. */}
        <div className="w-[var(--space-6)] shrink-0" aria-hidden="true" />
        <p className="text-sm font-medium text-[var(--text)]">{t(config.labelKey)}</p>
      </div>

      {isConnected ? (
        <div className="relative mt-[var(--space-4)]">
          <div className="flex items-center justify-between gap-[var(--space-6)]">
            <p className="flex items-center gap-[var(--space-2)] text-sm text-[var(--text)]">
              <span aria-hidden="true">✓</span>
              <span>
                {t('settings.accounts.connectedAs', { name: authStatus.displayName ?? '' })}
              </span>
            </p>
            <button
              type="button"
              onClick={() => void handleDisconnect()}
              disabled={isDisconnecting}
              className="rounded-control border border-[var(--border)] px-[var(--space-4)] py-[var(--space-2)] text-sm text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50 motion-safe:transition-colors"
            >
              {isDisconnecting
                ? t('settings.accounts.disconnecting')
                : t('settings.accounts.disconnect')}
            </button>
          </div>
          {errorKey && (
            <p
              className="mt-[var(--space-3)] flex items-center gap-[var(--space-2)] text-sm text-[var(--error)]"
              role="alert"
            >
              <span aria-hidden="true">⚠</span>
              {t(errorKey)}
            </p>
          )}
        </div>
      ) : isUnreachable ? (
        <div className="relative mt-[var(--space-4)]">
          <p
            className="flex items-center gap-[var(--space-2)] text-sm text-[var(--text-dim)]"
            role="status"
          >
            <span aria-hidden="true">⚠</span>
            <span>{t('settings.accounts.unreachable', { platform: t(config.labelKey) })}</span>
          </p>
          <div className="mt-[var(--space-3)] flex items-center gap-[var(--space-3)]">
            <button
              type="button"
              onClick={() => void handleRetry()}
              disabled={isRetrying || isDisconnecting}
              className="rounded-control border border-[var(--border)] px-[var(--space-4)] py-[var(--space-2)] text-sm text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50 motion-safe:transition-colors"
            >
              {isRetrying ? t('settings.accounts.retrying') : t('settings.accounts.retry')}
            </button>
            <button
              type="button"
              onClick={() => void handleDisconnect()}
              disabled={isRetrying || isDisconnecting}
              className="rounded-control border border-[var(--border)] px-[var(--space-4)] py-[var(--space-2)] text-sm text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50 motion-safe:transition-colors"
            >
              {isDisconnecting
                ? t('settings.accounts.disconnecting')
                : t('settings.accounts.signOut')}
            </button>
          </div>
          {errorKey && (
            <p
              className="mt-[var(--space-3)] flex items-center gap-[var(--space-2)] text-sm text-[var(--error)]"
              role="alert"
            >
              <span aria-hidden="true">⚠</span>
              {t(errorKey)}
            </p>
          )}
        </div>
      ) : (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          noValidate
          className="relative mt-[var(--space-4)]"
        >
          {!pending2fa ? (
            <div className="flex flex-col gap-[var(--space-3)]">
              <div>
                <label
                  htmlFor={`${platform}-username`}
                  className="mb-[var(--space-1)] block text-xs text-[var(--text-dim)]"
                >
                  {t('settings.accounts.username')}
                </label>
                <input
                  id={`${platform}-username`}
                  type="text"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isSubmitting}
                  className={inputClass}
                  placeholder={t('settings.accounts.usernamePlaceholder')}
                />
              </div>

              <div>
                <label
                  htmlFor={`${platform}-password`}
                  className="mb-[var(--space-1)] block text-xs text-[var(--text-dim)]"
                >
                  {t('settings.accounts.password')}
                </label>
                <input
                  id={`${platform}-password`}
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isSubmitting}
                  className={inputClass}
                  placeholder={t('settings.accounts.passwordPlaceholder')}
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
                disabled={isSubmitting || !username || !password}
                className={`mt-[var(--space-1)] self-start rounded-control border px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold hover:opacity-90 disabled:opacity-50 motion-safe:transition-opacity ${config.actionClass}`}
              >
                {isSubmitting ? t('settings.accounts.connecting') : t('settings.accounts.connect')}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-[var(--space-3)]">
              <p className="text-sm text-[var(--text-dim)]">
                {t(
                  pending2fa === 'totp'
                    ? 'settings.accounts.twoFactor.promptTotp'
                    : 'settings.accounts.twoFactor.promptEmail'
                )}
              </p>
              <div>
                <label
                  htmlFor={`${platform}-2fa`}
                  className="mb-[var(--space-1)] block text-xs text-[var(--text-dim)]"
                >
                  {t('settings.accounts.twoFactor.code')}
                </label>
                <input
                  id={`${platform}-2fa`}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                  disabled={isSubmitting}
                  className={inputClass}
                  placeholder={t('settings.accounts.twoFactor.placeholder')}
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
                className={`rounded-control border px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold hover:opacity-90 disabled:opacity-50 motion-safe:transition-opacity ${config.actionClass}`}
              >
                {isSubmitting
                  ? t('settings.accounts.connecting')
                  : t('settings.accounts.twoFactor.verify')}
              </button>
              <button
                type="button"
                onClick={handleTwoFactorBack}
                disabled={isSubmitting}
                className="rounded-control px-[var(--space-4)] py-[var(--space-2)] text-sm text-[var(--text-dim)] hover:bg-[var(--surface-hover)] disabled:opacity-50 motion-safe:transition-colors"
              >
                {t('settings.accounts.twoFactor.back')}
              </button>
            </div>
          )}
        </form>
      )}
    </div>
  )
}
