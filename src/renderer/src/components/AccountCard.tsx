import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import type { Platform } from '@shared/types'
import { authStatusQueryKey, useAuthStatus } from '../queries/auth'
import { friendsQueryKey } from '../queries/friends'
import { persistQueryCacheNow } from '../queries/cache'
import { ACCOUNT_CARD_CONFIG, accountLoginErrorKey } from '../utils/accountCard'
import { useAuthFlow } from '../hooks/useAuthFlow'
import CredentialsForm from './auth/CredentialsForm'
import TwoFactorForm from './auth/TwoFactorForm'
import ErrorBanner from './auth/ErrorBanner'
import { ACCOUNT_COPY } from './auth/copy'

export default function AccountCard({ platform }: { platform: Platform }): React.JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: authStatus } = useAuthStatus(platform)
  const config = ACCOUNT_CARD_CONFIG[platform]

  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)

  // A restored session can drift into needs-2fa while the card is mounted —
  // the reactive seed for the shared flow's 2FA leg (VRChat only; CVR has none).
  const authStatusTwoFactor =
    platform === 'vrchat' && authStatus?.state === 'needs-2fa'
      ? (authStatus.twoFactorMethod ?? 'totp')
      : null

  const flow = useAuthFlow(platform, {
    errorKeyForCode: (code) => accountLoginErrorKey(platform, code),
    externalTwoFactor: authStatusTwoFactor,
    dropPasswordAfterSubmit: true,
    // A fresh login changes who the friends data belongs to — settle it too.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: friendsQueryKey(platform) })
  })

  async function handleDisconnect(): Promise<void> {
    flow.setErrorKey(null)
    if (!window.vrx) {
      flow.setErrorKey('settings.accounts.error.unknown')
      return
    }

    setIsDisconnecting(true)
    try {
      await window.vrx.logout({ platform })
      // Settle auth FIRST (flips useFriends' enabled gate off), THEN empty the
      // platform's mounted roster without removing its observer. Logout means
      // the data must GO (a later login may be a different account), not refetch.
      await queryClient.invalidateQueries({ queryKey: authStatusQueryKey(platform) })
      queryClient.setQueryData(friendsQueryKey(platform), [])
      persistQueryCacheNow(queryClient)
    } catch {
      flow.setErrorKey('settings.accounts.error.disconnect')
    } finally {
      setIsDisconnecting(false)
    }
  }

  async function handleRetry(): Promise<void> {
    flow.setErrorKey(null)
    setIsRetrying(true)
    try {
      // Refetch the auth status; on recovery the card settles back to its
      // connected (or unauthenticated) rendering by itself.
      await queryClient.invalidateQueries({ queryKey: authStatusQueryKey(platform) })
    } finally {
      setIsRetrying(false)
    }
  }

  const isConnected = authStatus?.state === 'authenticated'
  // `error` = the platform couldn't be reached / its reply couldn't be read
  // (VRX-201) — the session may be alive, so NEVER show the Connect form here
  // (re-entering credentials would create a duplicate session). Quiet banner +
  // Retry + Sign out instead; identical path for both platforms.
  const isUnreachable = authStatus?.state === 'error'

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
          <ErrorBanner errorKey={flow.errorKey} className="mt-[var(--space-3)]" />
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
          <ErrorBanner errorKey={flow.errorKey} className="mt-[var(--space-3)]" />
        </div>
      ) : flow.pending2fa === null ? (
        <CredentialsForm
          idPrefix={platform}
          autocompleteSection={platform}
          copy={ACCOUNT_COPY}
          username={flow.username}
          password={flow.password}
          isSubmitting={flow.isSubmitting}
          errorKey={flow.errorKey}
          onUsernameChange={flow.setUsername}
          onPasswordChange={flow.setPassword}
          onSubmit={(e) => void flow.handleSubmit(e)}
          inputFocusClass={config.focusClass}
          submitClassName={`mt-[var(--space-1)] self-start rounded-control border px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold hover:opacity-90 disabled:opacity-50 motion-safe:transition-opacity ${config.actionClass}`}
          formClassName="relative mt-[var(--space-4)]"
        />
      ) : (
        <TwoFactorForm
          idPrefix={platform}
          copy={ACCOUNT_COPY}
          method={flow.pending2fa}
          code={flow.twoFactorCode}
          isSubmitting={flow.isSubmitting}
          errorKey={flow.errorKey}
          onCodeChange={flow.setTwoFactorCode}
          onSubmit={(e) => void flow.handleSubmit(e)}
          onBack={flow.handleBack}
          inputFocusClass={config.focusClass}
          submitClassName={`rounded-control border px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold hover:opacity-90 disabled:opacity-50 motion-safe:transition-opacity ${config.actionClass}`}
          formClassName="relative mt-[var(--space-4)]"
        />
      )}
    </div>
  )
}
