import { useTranslation } from 'react-i18next'
import type { Platform } from '@shared/types'
import { ACCOUNT_CARD_CONFIG } from '../../utils/accountCard'

/**
 * "Use my sign-in from this PC" (owner, 2026-10-20). Signing in with a password
 * stays the main way; this quieter outlined button sits under it in the same
 * place, at the same size, for both platforms. The press is the consent: main
 * only then reads VRCX or ChilloutVR/CVRX, read-only.
 */
export default function ImportSignInAction({
  platform,
  isSubmitting,
  isImporting,
  onImport
}: {
  platform: Platform
  isSubmitting: boolean
  isImporting: boolean
  onImport: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const config = ACCOUNT_CARD_CONFIG[platform]
  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <button
        type="button"
        onClick={onImport}
        disabled={isSubmitting}
        className="self-start rounded-control border border-[var(--border)] px-[var(--space-3)] py-[var(--space-1)] text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50 motion-safe:transition-colors"
      >
        {isImporting ? t('settings.accounts.import.looking') : t(config.importLabelKey)}
      </button>
      <p className="text-xs text-[var(--text-dim)]">{t(config.importHintKey)}</p>
    </div>
  )
}
