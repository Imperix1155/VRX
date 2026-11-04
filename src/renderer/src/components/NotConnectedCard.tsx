import { useTranslation } from 'react-i18next'

/** A page's "not connected" card: what isn't connected, and Open Accounts. */
export default function NotConnectedCard({
  message,
  onOpenAccounts
}: {
  /** Already translated; null shows the button alone. */
  message: string | null
  onOpenAccounts: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="glass glass-layer flex flex-col items-center justify-center gap-[var(--space-3)] p-[var(--space-10)] text-center min-h-[180px]">
      <p className="text-sm font-semibold text-[var(--text-dim)]">{message}</p>
      <button
        type="button"
        onClick={onOpenAccounts}
        className="rounded-control px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--text)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] motion-safe:transition-colors"
      >
        {t('dashboard.notConnected.openAccounts')}
      </button>
    </div>
  )
}
