import { useTranslation } from 'react-i18next'
import type { Platform } from '@shared/types'
import { useSettingsStore } from '../stores/settings'
import { useAuthStatus } from '../queries/auth'
import { ACCOUNT_CARD_CONFIG } from '../utils/accountCard'

const buttonClass =
  'shrink-0 rounded-control border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--text)] hover:bg-[var(--control-fill-hover)] disabled:opacity-50'
const noticeClass =
  'glass glass-information mb-[var(--space-3)] flex flex-wrap items-center justify-between gap-[var(--space-3)] p-[var(--space-3)] text-sm text-[var(--text-dim)]'

function AuthNotice({ platform }: { platform: Platform }): React.JSX.Element | null {
  const { t } = useTranslation()
  const { isError, isFetching, refetch } = useAuthStatus(platform)
  if (!isError) return null
  return (
    <div className={noticeClass} role="status">
      <span>
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

/** Persistent recovery controls outside the replaceable panel boundary. */
export default function RecoveryNotices(): React.JSX.Element {
  const { t } = useTranslation()
  const { dirty, saveError, saving, retrySave } = useSettingsStore()
  return (
    <>
      {dirty && (
        <div className={noticeClass} role={saveError ? 'alert' : 'status'}>
          <span>
            {t(saveError ? 'settings.persistence.error' : 'settings.persistence.unsaved')}
          </span>
          {saveError && (
            <button type="button" className={buttonClass} disabled={saving} onClick={retrySave}>
              {t(saving ? 'settings.persistence.saving' : 'settings.persistence.retry')}
            </button>
          )}
        </div>
      )}
      <AuthNotice platform="vrchat" />
      <AuthNotice platform="chilloutvr" />
    </>
  )
}
