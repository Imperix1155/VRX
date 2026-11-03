import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import type { Platform } from '@shared/types'
import { authStatusQueryKey, useAuthStatus } from '../queries/auth'
import { EMPTY_ROSTER_PLACEHOLDER, friendsQueryKey } from '../queries/friends'
import { persistQueryCacheNow } from '../queries/cache'
import { ACCOUNT_CARD_CONFIG, accountLoginErrorKey } from '../utils/accountCard'
import { useAuthFlow } from '../hooks/useAuthFlow'
import CredentialsForm from './auth/CredentialsForm'
import TwoFactorForm from './auth/TwoFactorForm'
import ErrorBanner from './auth/ErrorBanner'
import ImportSignInAction from './auth/ImportSignInAction'
import { accountCopy } from './auth/copy'
import OwnProfileDialog from './OwnProfileDialog'

const ACCOUNT_BUTTON =
  'rounded-control border border-[var(--border)] px-[var(--space-4)] py-[var(--space-2)] text-sm text-[var(--text)] hover:bg-[var(--surface-hover)] aria-disabled:opacity-50 motion-safe:transition-colors'

/**
 * Sign out asks once, in place, starting on Cancel: it ends the session, and
 * signing back in needs the password again.
 */
function SignOutQuestion({
  question,
  busy,
  held,
  onConfirm,
  onCancel
}: {
  question: string
  /** Signing out now. */
  busy: boolean
  /** Sign out waits, as the button it replaced does (a code is being sent). */
  held: boolean
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])
  return (
    <div
      role="group"
      aria-label={question}
      className="flex basis-full flex-wrap items-center gap-x-[var(--space-3)] gap-y-[var(--space-2)]"
    >
      <p className="min-w-0 flex-1 basis-[10rem] text-sm text-[var(--text)]">{question}</p>
      <div className="flex shrink-0 gap-[var(--space-2)]">
        {/* Not `disabled`: a disabled button drops keyboard focus. */}
        <button
          type="button"
          onClick={() => {
            if (!busy && !held) onConfirm()
          }}
          aria-disabled={busy || held || undefined}
          className={ACCOUNT_BUTTON}
        >
          {busy ? t('settings.accounts.disconnecting') : t('settings.accounts.signOut')}
        </button>
        <button
          ref={cancelRef}
          type="button"
          onClick={() => {
            if (!busy) onCancel()
          }}
          aria-disabled={busy || undefined}
          className={ACCOUNT_BUTTON}
        >
          {t('settings.accounts.cancel')}
        </button>
      </div>
    </div>
  )
}

export default function AccountCard({
  platform,
  profileEditing = false
}: {
  platform: Platform
  /** Settings → Accounts offers Edit profile; the welcome setup keeps to signing in. */
  profileEditing?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: authStatus, isPending, isError } = useAuthStatus(platform)
  const config = ACCOUNT_CARD_CONFIG[platform]

  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)
  // Whichever Sign out button shows; focus goes back to it after the question.
  const signOutRef = useRef<HTMLButtonElement>(null)
  const returnFocusToSignOut = useRef(false)
  useEffect(() => {
    if (confirmingSignOut || !returnFocusToSignOut.current) return
    returnFocusToSignOut.current = false
    signOutRef.current?.focus()
  }, [confirmingSignOut])

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

  // The question belongs to the sign-in state it was asked in: any change
  // closes it, so it never comes back on its own after signing in again.
  const signOutContext = `${isError}:${authStatus?.state}:${flow.pending2fa === null}`
  const [questionContext, setQuestionContext] = useState(signOutContext)
  if (questionContext !== signOutContext) {
    setQuestionContext(signOutContext)
    setConfirmingSignOut(false)
  }

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
      queryClient.setQueryData(friendsQueryKey(platform), [], EMPTY_ROSTER_PLACEHOLDER)
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

  const signOutQuestion = confirmingSignOut ? (
    <SignOutQuestion
      question={t('settings.accounts.signOutConfirm', { platform: t(config.labelKey) })}
      busy={isDisconnecting}
      held={isRetrying || flow.isSubmitting}
      onConfirm={() => {
        returnFocusToSignOut.current = true
        void handleDisconnect().finally(() => setConfirmingSignOut(false))
      }}
      onCancel={() => {
        returnFocusToSignOut.current = true
        setConfirmingSignOut(false)
      }}
    />
  ) : null
  const askSignOut = (): void => setConfirmingSignOut(true)

  const isConnected = !isError && authStatus?.state === 'authenticated'
  // `error` = the platform couldn't be reached / its reply couldn't be read
  // (VRX-201) — the session may be alive, so NEVER show the Connect form here
  // (re-entering credentials would create a duplicate session). Quiet banner +
  // Retry + Sign out instead; identical path for both platforms.
  const isUnreachable = isError || authStatus?.state === 'error'

  return (
    <div
      className={`glass glass-information ${config.tintClass} relative overflow-hidden p-[var(--space-6)]`}
    >
      {/* The name lines up with the status and buttons below it. A future
          platform logo would go in front of it; do not restore PlatformGlyph. */}
      <div className="relative flex items-center gap-[var(--space-3)]">
        <p className="text-sm font-medium text-[var(--text)]">{t(config.labelKey)}</p>
      </div>

      {isPending ? (
        <p role="status" className="mt-[var(--space-4)] text-sm text-[var(--text-dim)]">
          {t('boot.connecting')}
        </p>
      ) : isConnected ? (
        <div className="relative mt-[var(--space-4)]">
          {/* Wraps the button under the name in a narrow card instead of
              squeezing "Connected as …" into a tall column. */}
          <div className="flex flex-wrap items-center justify-between gap-x-[var(--space-4)] gap-y-[var(--space-3)]">
            <p className="flex items-center gap-[var(--space-2)] text-sm text-[var(--text)]">
              <span aria-hidden="true">✓</span>
              <span>
                {t('settings.accounts.connectedAs', { name: authStatus.displayName ?? '' })}
              </span>
            </p>
            {/* With Edit profile: its own row, each button growing to fill it, one
                line in English, two full-width lines where words are longer (Japanese).
                Sign out's question takes the row's place until it is answered. */}
            {signOutQuestion ??
              (profileEditing ? (
                <div className="flex basis-full flex-wrap gap-[var(--space-2)]">
                  <button
                    type="button"
                    onClick={() => {
                      setProfileSaved(false)
                      setEditingProfile(true)
                    }}
                    disabled={isDisconnecting}
                    className="flex-auto whitespace-nowrap rounded-control border border-[var(--border)] px-[var(--space-4)] py-[var(--space-2)] text-sm text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50 motion-safe:transition-colors"
                  >
                    {t('settings.accounts.profile.edit')}
                  </button>
                  <button
                    ref={signOutRef}
                    type="button"
                    onClick={askSignOut}
                    disabled={isDisconnecting}
                    className="flex-auto whitespace-nowrap rounded-control border border-[var(--border)] px-[var(--space-4)] py-[var(--space-2)] text-sm text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50 motion-safe:transition-colors"
                  >
                    {t('settings.accounts.signOut')}
                  </button>
                </div>
              ) : (
                <button
                  ref={signOutRef}
                  type="button"
                  onClick={askSignOut}
                  disabled={isDisconnecting}
                  className="rounded-control border border-[var(--border)] px-[var(--space-4)] py-[var(--space-2)] text-sm text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50 motion-safe:transition-colors"
                >
                  {t('settings.accounts.signOut')}
                </button>
              ))}
          </div>
          <p role="status" className="text-xs text-[var(--text-dim)]">
            {profileSaved ? (
              <span className="mt-[var(--space-2)] block">
                <span aria-hidden="true">✓ </span>
                {t('settings.accounts.profile.saved', { platform: t(config.labelKey) })}
              </span>
            ) : null}
          </p>
          <ErrorBanner errorKey={flow.errorKey} className="mt-[var(--space-3)]" />
          {profileEditing && editingProfile && (
            <OwnProfileDialog
              platform={platform}
              onClose={() => setEditingProfile(false)}
              onSaved={() => {
                setEditingProfile(false)
                setProfileSaved(true)
              }}
            />
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
            {signOutQuestion ?? (
              <>
                <button
                  type="button"
                  onClick={() => void handleRetry()}
                  disabled={isRetrying || isDisconnecting}
                  className="rounded-control border border-[var(--border)] px-[var(--space-4)] py-[var(--space-2)] text-sm text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50 motion-safe:transition-colors"
                >
                  {isRetrying ? t('settings.accounts.retrying') : t('settings.accounts.retry')}
                </button>
                <button
                  ref={signOutRef}
                  type="button"
                  onClick={askSignOut}
                  disabled={isRetrying || isDisconnecting}
                  className="rounded-control border border-[var(--border)] px-[var(--space-4)] py-[var(--space-2)] text-sm text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50 motion-safe:transition-colors"
                >
                  {t('settings.accounts.signOut')}
                </button>
              </>
            )}
          </div>
          <ErrorBanner errorKey={flow.errorKey} className="mt-[var(--space-3)]" />
        </div>
      ) : flow.pending2fa === null ? (
        <CredentialsForm
          idPrefix={platform}
          autocompleteSection={platform}
          copy={accountCopy(platform)}
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
          submitBusy={flow.isSubmitting && !flow.isImporting}
          secondaryAction={
            <ImportSignInAction
              platform={platform}
              isSubmitting={flow.isSubmitting}
              isImporting={flow.isImporting}
              onImport={() => void flow.handleImport()}
            />
          }
        />
      ) : (
        <>
          <TwoFactorForm
            idPrefix={platform}
            copy={accountCopy(platform)}
            method={flow.pending2fa}
            code={flow.twoFactorCode}
            isSubmitting={flow.isSubmitting}
            locked={isDisconnecting}
            errorKey={flow.errorKey}
            onCodeChange={flow.setTwoFactorCode}
            onSubmit={(e) => void flow.handleSubmit(e)}
            onBack={flow.handleBack}
            inputFocusClass={config.focusClass}
            submitClassName={`rounded-control border px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold hover:opacity-90 disabled:opacity-50 motion-safe:transition-opacity ${config.actionClass}`}
            formClassName="relative mt-[var(--space-4)]"
          />
          {/* A saved session that needs a fresh code stays saved (and asks again
              every launch) until it is verified or signed out, so it gets the
              same Sign out as the other saved-session states. */}
          {authStatus?.state === 'needs-2fa' ? (
            <div className="relative mt-[var(--space-3)]">
              {signOutQuestion ?? (
                <button
                  ref={signOutRef}
                  type="button"
                  onClick={askSignOut}
                  disabled={isDisconnecting || flow.isSubmitting}
                  className="rounded-control border border-[var(--border)] px-[var(--space-4)] py-[var(--space-2)] text-sm text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50 motion-safe:transition-colors"
                >
                  {t('settings.accounts.signOut')}
                </button>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
