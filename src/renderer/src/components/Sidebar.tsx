import { useTranslation } from 'react-i18next'
import { useUiStore, type ActiveTab } from '../stores/ui'
import { useFriendsStore, type PlatformFilter } from '../stores/friends'
import { useUpdater } from '../hooks/useUpdater'

// SVG icons — inlined per glass.html reference (18×18, stroke-width 1.8)
function IconDashboard(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="w-[18px] h-[18px] flex-none"
    >
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="11" width="7" height="10" rx="1.5" />
      <rect x="3" y="15" width="7" height="6" rx="1.5" />
    </svg>
  )
}

function IconActivity(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="w-[18px] h-[18px] flex-none"
    >
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  )
}

function IconFriends(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="w-[18px] h-[18px] flex-none"
    >
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c0-3 2.4-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 6.6a3 3 0 0 1 0 5.8" />
      <path d="M16.6 14c2.3.2 3.9 2 3.9 4.4" />
    </svg>
  )
}

function IconInstances(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="w-[18px] h-[18px] flex-none"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.6 2.4 2.6 14.6 0 17M12 3.5c-2.6 2.4-2.6 14.6 0 17" />
    </svg>
  )
}

function IconGroups(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="w-[18px] h-[18px] flex-none"
    >
      <circle cx="8.5" cy="9" r="2.7" />
      <circle cx="16" cy="9.5" r="2.2" />
      <path d="M3.5 18c0-2.7 2.2-4.4 5-4.4 1 0 1.9.2 2.7.6" />
      <path d="M13.5 14.4c.7-.3 1.5-.5 2.5-.5 2.5 0 4.5 1.5 4.5 3.6" />
    </svg>
  )
}

function IconSettings(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="w-[18px] h-[18px] flex-none"
    >
      <line x1="4" y1="8" x2="20" y2="8" />
      <line x1="4" y1="16" x2="20" y2="16" />
      <circle cx="9" cy="8" r="2.4" />
      <circle cx="15" cy="16" r="2.4" />
    </svg>
  )
}

function IconDownload(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="w-[18px] h-[18px] flex-none"
    >
      <path d="M12 3v12M7 12l5 5 5-5M5 21h14" />
    </svg>
  )
}

function IconSpinner(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="w-[18px] h-[18px] flex-none motion-safe:animate-spin"
    >
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  )
}

function IconRestart(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="w-[18px] h-[18px] flex-none"
    >
      <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v6h-6" />
    </svg>
  )
}

function SidebarUpdateButton(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { state, download, install } = useUpdater()

  if (!['update-available', 'downloading', 'downloaded'].includes(state.state)) {
    return null
  }

  const isDownloading = state.state === 'downloading'
  const isDownloaded = state.state === 'downloaded'

  const label = isDownloading
    ? state.progressPercent > 0
      ? t('updater.sidebar.downloading')
      : t('updater.sidebar.downloading')
    : isDownloaded
      ? t('updater.sidebar.restart')
      : t('updater.sidebar.update')

  const ariaLabel = isDownloading
    ? t('updater.sidebar.downloadingAria', { percent: state.progressPercent })
    : isDownloaded
      ? t('updater.sidebar.restartAria')
      : t('updater.sidebar.downloadAria')

  const handleClick = (): void => {
    if (isDownloading) return
    if (isDownloaded) {
      void install()
    } else {
      void download()
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel}
      aria-disabled={isDownloading}
      className={[
        'group absolute right-[10px] top-1/2 -translate-y-1/2',
        'flex items-center justify-start',
        'h-[28px] w-[28px] hover:w-[92px] focus-visible:w-[92px]',
        'rounded-full border border-[var(--border)]',
        'bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)]',
        'text-[var(--text)]',
        'focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)]',
        'pl-[5px] pr-0 hover:pr-[10px] focus-visible:pr-[10px]',
        'cursor-pointer',
        'motion-safe:transition-all motion-safe:duration-200'
      ].join(' ')}
    >
      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
        {isDownloading ? <IconSpinner /> : isDownloaded ? <IconRestart /> : <IconDownload />}
      </span>
      <span
        className={[
          'overflow-hidden whitespace-nowrap',
          'max-w-0 group-hover:max-w-[60px] group-focus-visible:max-w-[60px]',
          'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
          'ml-0 group-hover:ml-[6px] group-focus-visible:ml-[6px]',
          'text-[11px] font-medium',
          'motion-safe:transition-all motion-safe:duration-200'
        ].join(' ')}
      >
        {isDownloading && state.progressPercent > 0 ? `${state.progressPercent}%` : label}
      </span>
    </button>
  )
}

function indicatorBackground(filter: PlatformFilter): string {
  switch (filter) {
    case 'vrchat':
      return 'var(--vrc)'
    case 'chilloutvr':
      return 'var(--cvr)'
    default:
      // "All" keeps the exact existing blue→orange merge gradient (§8/§9.1).
      return 'linear-gradient(var(--vrc), var(--cvr))'
  }
}

const NAV_ITEMS: Array<{ id: ActiveTab; icon: () => React.JSX.Element }> = [
  { id: 'dashboard', icon: IconDashboard },
  { id: 'activity', icon: IconActivity },
  { id: 'friends', icon: IconFriends },
  { id: 'instances', icon: IconInstances },
  { id: 'groups', icon: IconGroups },
  { id: 'settings', icon: IconSettings }
]

export default function Sidebar(): React.JSX.Element {
  const { t } = useTranslation()
  const activeTab = useUiStore((s) => s.activeTab)
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  const platformFilter = useFriendsStore((s) => s.platformFilter)

  return (
    <aside className="glass flex flex-col" style={{ padding: '20px 16px' }}>
      {/* Brand mark (§1) */}
      <div
        className="font-mono text-[40px] leading-none tracking-[2px] flex gap-[1px] pb-0"
        style={{ padding: '4px 6px 0' }}
        aria-label="VRX"
      >
        <span style={{ color: 'var(--vrc)' }}>V</span>
        <span style={{ color: 'var(--bridge)' }}>R</span>
        <span style={{ color: 'var(--cvr)' }}>X</span>
      </div>
      <div
        className="text-[11px] text-[var(--text-faint)] tracking-[0.5px]"
        style={{ padding: '4px 6px 0', marginBottom: '22px' }}
      >
        {t('shell.subtitle')}
      </div>

      {/* Nav (§8) */}
      <nav className="flex flex-col gap-[3px] flex-1" aria-label={t('shell.nav.aria')}>
        {NAV_ITEMS.map(({ id, icon: Icon }) => {
          const isActive = activeTab === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              aria-current={isActive ? 'page' : undefined}
              className={[
                'relative flex items-center gap-[12px] px-[11px] py-[9px] rounded-control',
                'text-[13.5px] font-semibold border border-transparent cursor-pointer',
                'motion-safe:transition-colors',
                isActive
                  ? 'text-[var(--text)]'
                  : 'text-[var(--text-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]'
              ].join(' ')}
              style={
                isActive
                  ? {
                      background: 'var(--control-active-bg)',
                      borderColor: 'var(--control-active-border)',
                      boxShadow: 'var(--control-active-shadow)'
                    }
                  : undefined
              }
            >
              {/* Left spine — active only. Echoes the global platform filter:
                  All = existing blue→orange gradient; single platform = solid platform
                  hue. Position carries "active page"; color is a reinforcing echo
                  (the segmented toggle remains the primary carrier). */}
              {isActive && (
                <span
                  className="absolute left-[-16px] w-[3px] h-[20px] rounded-[2px]"
                  style={{ background: indicatorBackground(platformFilter) }}
                  data-platform-filter={platformFilter}
                  aria-hidden="true"
                />
              )}
              <Icon />
              {t(`shell.nav.${id}`)}
            </button>
          )
        })}
      </nav>

      {/* Footer (§8) */}
      <div
        className="relative text-[11px] text-[var(--text-faint)] pt-[12px] mt-[12px]"
        style={{ borderTop: '1px solid var(--sidebar-foot-border)' }}
      >
        <SidebarUpdateButton />
        <span
          className="font-mono text-[16px] tracking-[1px] text-[var(--text-dim)]"
          aria-hidden="true"
        >
          VRX
        </span>
        <br />
        {/* Version is build-injected from package.json (never hardcode — it drifts) */}
        {t('shell.footer')} · v{__APP_VERSION__}
      </div>
    </aside>
  )
}
