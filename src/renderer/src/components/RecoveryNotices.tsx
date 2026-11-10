import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Platform } from '@shared/types'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import { useAuthStatus } from '../queries/auth'
import { isAuthCheckFailing } from '../queries/authCheck'
import { useSignedOutByPlatform } from '../hooks/useSignedOutByPlatform'
import { ACCOUNT_CARD_CONFIG } from '../utils/accountCard'

// A compact one-row strip: text and its action share the row, so a notice
// costs Settings (no scrolling at the default size, DESIGN.md §8) as little
// height as possible. A busy Retry is aria-disabled, not disabled, so keyboard
// focus stays on it and is still there if the retry fails.
const buttonClass =
  'shrink-0 rounded-control border border-[var(--border)] px-[var(--space-3)] py-[var(--space-1)] text-xs text-[var(--text)] hover:bg-[var(--control-fill-hover)] disabled:opacity-50 aria-disabled:cursor-default aria-disabled:opacity-50'
const noticeClass =
  'glass glass-layer mb-[var(--space-2)] flex items-center gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)] text-xs leading-snug text-[var(--text-dim)]'

/** A button that removes its own notice hands keyboard focus to the page,
 *  never to the document body. */
function focusPage(): void {
  document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true })
}

function AuthNotice({ platform }: { platform: Platform }): React.JSX.Element | null {
  const { t } = useTranslation()
  const { isError, isFetching, status, errorUpdatedAt, refetch } = useAuthStatus(platform)
  // Also while Retry runs the check again, so the notice and keyboard focus
  // on Retry stay until it answers.
  if (!isAuthCheckFailing({ isError, status, errorUpdatedAt })) return null
  return (
    <div className={noticeClass} role="status">
      <span className="min-w-0 flex-1">
        {t('settings.accounts.unreachable', {
          platform: t(ACCOUNT_CARD_CONFIG[platform].labelKey)
        })}
      </span>
      <button
        type="button"
        className={buttonClass}
        aria-disabled={isFetching || undefined}
        onClick={() => {
          if (!isFetching) void refetch()
        }}
      >
        {t(isFetching ? 'settings.accounts.retrying' : 'settings.accounts.retry')}
      </button>
    </div>
  )
}

/**
 * A saved session waiting for a fresh sign-in code (VRChat only today). Under
 * All the other platform keeps the app usable, so without this line the
 * platform would just look empty. Accounts is where the code is entered.
 */
function TwoFactorNotice({ platform }: { platform: Platform }): React.JSX.Element | null {
  const { t } = useTranslation()
  const needsCode = useAuthStatus(platform).data?.state === 'needs-2fa'
  const onAccounts = useUiStore(
    (s) => s.activeTab === 'settings' && s.settingsCategory === 'accounts'
  )
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  const setSettingsCategory = useUiStore((s) => s.setSettingsCategory)
  if (!needsCode || onAccounts) return null
  return (
    <div className={noticeClass} role="status">
      <span>
        {t('settings.accounts.needsCode', {
          platform: t(ACCOUNT_CARD_CONFIG[platform].labelKey)
        })}
      </span>
      <button
        type="button"
        className={buttonClass}
        onClick={() => {
          setActiveTab('settings')
          setSettingsCategory('accounts')
        }}
      >
        {t('settings.accounts.openAccounts')}
      </button>
    </div>
  )
}

/**
 * The platform ended the session on its own (a refused or expired sign-in),
 * at launch or while VRX ran. Under All the other platform keeps the app
 * going, so without this line that platform's friends would just vanish.
 * It stays until the user signs in again or hides it; Accounts, where the
 * sign-in happens, doesn't repeat it.
 */
function SignedOutNotice({ platform }: { platform: Platform }): React.JSX.Element | null {
  const { t } = useTranslation()
  const signedOut = useSignedOutByPlatform(platform)
  const onAccounts = useUiStore(
    (s) => s.activeTab === 'settings' && s.settingsCategory === 'accounts'
  )
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  const setSettingsCategory = useUiStore((s) => s.setSettingsCategory)
  const setHidden = useUiStore((s) => s.setSignOutNoticeHidden)
  if (!signedOut || onAccounts) return null
  const name = t(ACCOUNT_CARD_CONFIG[platform].labelKey)
  return (
    <div className={noticeClass} role="alert" data-signed-out-notice={platform}>
      {/* The non-color cue (R2): a warning glyph before the words. */}
      <span aria-hidden="true" className="shrink-0 text-sm text-[var(--error)]">
        ⚠
      </span>
      <span className="min-w-0 flex-1">
        {t('settings.accounts.signedOutByPlatform', { platform: name })}
      </span>
      <button
        type="button"
        className={buttonClass}
        onClick={() => {
          setActiveTab('settings')
          setSettingsCategory('accounts')
          focusPage()
        }}
      >
        {t('settings.accounts.openAccounts')}
      </button>
      <button
        type="button"
        className={buttonClass}
        aria-label={t('settings.accounts.hideSignedOut', { platform: name })}
        onClick={() => {
          setHidden(platform, true)
          focusPage()
        }}
      >
        {t('settings.accounts.hideNotice')}
      </button>
    </div>
  )
}

/** A healthy save settles within main's 250 ms debounce plus one IPC round trip.
 *  Only a save that is still pending after this delay is worth surfacing. */
export const SETTINGS_PENDING_NOTICE_DELAY_MS = 2_000

/**
 * Settings persistence notice. A failed save shows immediately as an alert with
 * Retry. Settings that could not be read (main answered with defaults) show as
 * an alert until a save reaches the real file. An ordinary in-flight save stays
 * silent: the pending notice appears only when the latest change is still
 * unsaved after SETTINGS_PENDING_NOTICE_DELAY_MS, so routine edits never flash
 * a banner or trigger a screen-reader announcement. The welcome setup, which
 * replaces the shell, shows it too.
 */
export function SettingsPersistenceNotice(): React.JSX.Element | null {
  const { t } = useTranslation()
  const dirty = useSettingsStore((s) => s.dirty)
  const saveError = useSettingsStore((s) => s.saveError)
  const loadFallback = useSettingsStore((s) => s.loadFallback)
  const newerFile = useSettingsStore((s) => s.newerFile)
  const saving = useSettingsStore((s) => s.saving)
  const settings = useSettingsStore((s) => s.settings)
  const retrySave = useSettingsStore((s) => s.retrySave)
  const [pendingSince, setPendingSince] = useState<object | null>(null)

  const waiting = dirty && !saveError
  useEffect(() => {
    if (!waiting) return
    // Restart the delay on every change so active editing never shows the notice.
    const timer = window.setTimeout(
      () => setPendingSince(settings),
      SETTINGS_PENDING_NOTICE_DELAY_MS
    )
    return () => window.clearTimeout(timer)
  }, [waiting, settings])

  const pendingTooLong = waiting && pendingSince === settings
  const failed = dirty && saveError
  // Failures first: a failed save, then settings that could not be read.
  const warning = failed || loadFallback
  if (!warning && !pendingTooLong) return null
  return (
    <div className={noticeClass} role={warning ? 'alert' : 'status'}>
      {/* The failure's non-color cue (R2): a warning glyph before its words. */}
      {warning && (
        <span aria-hidden="true" className="shrink-0 text-sm text-[var(--error)]">
          ⚠
        </span>
      )}
      <span className="min-w-0 flex-1">
        {t(
          failed
            ? newerFile
              ? 'settings.persistence.newerFile'
              : 'settings.persistence.error'
            : loadFallback
              ? 'settings.persistence.loadFallback'
              : 'settings.persistence.unsaved'
        )}
      </span>
      {/* A newer build's file is kept on purpose, so a Retry could never work. */}
      {failed && !newerFile && (
        <button
          type="button"
          className={buttonClass}
          aria-disabled={saving || undefined}
          onClick={() => {
            if (!saving) retrySave()
          }}
        >
          {t(saving ? 'settings.persistence.saving' : 'settings.persistence.retry')}
        </button>
      )}
    </div>
  )
}

/** Persistent recovery controls outside the replaceable panel boundary. */
export default function RecoveryNotices(): React.JSX.Element {
  return (
    <>
      <SettingsPersistenceNotice />
      <AuthNotice platform="vrchat" />
      <AuthNotice platform="chilloutvr" />
      <TwoFactorNotice platform="vrchat" />
      <TwoFactorNotice platform="chilloutvr" />
      <SignedOutNotice platform="vrchat" />
      <SignedOutNotice platform="chilloutvr" />
    </>
  )
}
