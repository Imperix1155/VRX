import { useTranslation } from 'react-i18next'
import { useUiStore } from '../stores/ui'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import FriendsList from './FriendsList'
import ErrorBoundary from './ErrorBoundary'

/** Glass "coming soon" stub for views not yet implemented. */
function ComingSoonStub({ labelKey }: { labelKey: string }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className="glass flex flex-col items-center justify-center text-center p-[var(--space-10)]"
      style={{ minHeight: '240px' }}
    >
      <div className="relative">
        <p className="text-[var(--text-dim)] text-sm">{t('shell.comingSoon')}</p>
        <p className="text-[var(--text-faint)] text-xs mt-[var(--space-1)]">{t(labelKey)}</p>
      </div>
    </div>
  )
}

function MainContent(): React.JSX.Element {
  const activeTab = useUiStore((s) => s.activeTab)

  switch (activeTab) {
    case 'friends':
      return (
        <ErrorBoundary variant="panel">
          <FriendsList />
        </ErrorBoundary>
      )
    case 'dashboard':
      return <ComingSoonStub labelKey="shell.nav.dashboard" />
    case 'activity':
      return <ComingSoonStub labelKey="shell.nav.activity" />
    case 'instances':
      return <ComingSoonStub labelKey="shell.nav.instances" />
    case 'groups':
      return <ComingSoonStub labelKey="shell.nav.groups" />
    case 'settings':
      return <ComingSoonStub labelKey="shell.nav.settings" />
  }
}

/**
 * §8 App shell — 248px sidebar | 1fr main, height:100vh, only .main scrolls.
 * Grid + overflow rules are inline style (not Tailwind) so they exactly match
 * the §8 CSS spec without needing a custom Tailwind plugin.
 */
export default function AppShell(): React.JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '248px 1fr',
        height: '100vh',
        padding: 'var(--space-4)',
        gap: 'var(--space-4)'
      }}
    >
      <Sidebar />
      <main
        style={{ overflowY: 'auto', padding: 'var(--space-2) var(--space-2) var(--space-10)' }}
        className="[&::-webkit-scrollbar]:w-[9px] [&::-webkit-scrollbar-thumb]:bg-[var(--scrollbar-thumb)] [&::-webkit-scrollbar-thumb]:rounded-full"
      >
        <TopBar />
        <MainContent />
      </main>
    </div>
  )
}
