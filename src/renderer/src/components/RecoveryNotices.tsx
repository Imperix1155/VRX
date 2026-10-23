import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Platform } from '@shared/types'
import { useSettingsStore } from '../stores/settings'
import { useAuthStatus } from '../queries/auth'
import { ACCOUNT_CARD_CONFIG } from '../utils/accountCard'

// A compact one-row strip: text and its action share the row, so a notice
// costs Settings (no scrolling at the default size, DESIGN.md §8) as little
// height as possible.
const buttonClass =
  'shrink-0 rounded-control border border-[var(--border)] px-[var(--space-3)] py-[var(--space-1)] text-xs text-[var(--text)] hover:bg-[var(--control-fill-hover)] disabled:opacity-50'
const noticeClass =
  'glass glass-information mb-[var(--space-2)] flex items-center gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)] text-xs leading-snug text-[var(--text-dim)]'

function AuthNotice({ platform }: { platform: Platform }): React.JSX.Element | null {
  const { t } = useTranslation()
  const { isError, isFetching, refetch } = useAuthStatus(platform)
  if (!isError) return null
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
        disabled={isFetching}
        onClick={() => {
          void refetch()
        }}
      >
        {t(isFetching ? 'settings.accounts.retrying' : 'settings.accounts.retry')}
      </button>
    </div>
  )
}

/** A healthy save settles within main's 250 ms debounce plus one IPC round trip.
 *  Only a save that is still pending after this delay is worth surfacing. */
export const SETTINGS_PENDING_NOTICE_DELAY_MS = 2_000

/**
 * Settings persistence notice. A failed save shows immediately as an alert with
 * Retry. An ordinary in-flight save stays silent: the pending notice appears only
 * when the latest change is still unsaved after SETTINGS_PENDING_NOTICE_DELAY_MS,
 * so routine edits never flash a banner or trigger a screen-reader announcement.
 */
function SettingsPersistenceNotice(): React.JSX.Element | null {
  const { t } = useTranslation()
  const dirty = useSettingsStore((s) => s.dirty)
  const saveError = useSettingsStore((s) => s.saveError)
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
  if (!dirty || (!saveError && !pendingTooLong)) return null
  return (
    <div className={noticeClass} role={saveError ? 'alert' : 'status'}>
      {/* The failure's non-color cue (R2): a warning glyph before its words. */}
      {saveError && (
        <span aria-hidden="true" className="shrink-0 text-sm text-[var(--error)]">
          ⚠
        </span>
      )}
      <span className="min-w-0 flex-1">
        {t(saveError ? 'settings.persistence.error' : 'settings.persistence.unsaved')}
      </span>
      {saveError && (
        <button type="button" className={buttonClass} disabled={saving} onClick={retrySave}>
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
    </>
  )
}
