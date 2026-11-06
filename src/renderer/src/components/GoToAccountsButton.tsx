import { useUiStore } from '../stores/ui'

/**
 * The small Go to Accounts button on a page's platform line: it opens
 * Settings → Accounts, where signing in happens. The caller names it, so each
 * page keeps its own copy key.
 */
export default function GoToAccountsButton({
  label,
  className = ''
}: {
  label: string
  className?: string
}): React.JSX.Element {
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  const setSettingsCategory = useUiStore((s) => s.setSettingsCategory)
  return (
    <button
      type="button"
      onClick={() => {
        setActiveTab('settings')
        setSettingsCategory('accounts')
      }}
      className={`${className} rounded-control px-[var(--space-2)] py-[var(--space-1)] text-xs text-[var(--text)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] motion-safe:transition-colors`.trim()}
    >
      {label}
    </button>
  )
}
