import { useTranslation } from 'react-i18next'
import { useUiStore, type ActiveTab } from '../stores/ui'
import { useSettingsStore } from '../stores/settings'
import { isPageShown } from '../utils/pages'
import { useFriendsStore, type PlatformFilter } from '../stores/friends'
import { useUpdater } from '../hooks/useUpdater'
import { IconDownload, IconSpinner, IconRestart } from './UpdaterIcons'
import { IconDashboard, IconExplore, IconFriends, IconHot, IconSettings } from './NavIcons'

function SidebarUpdateButton(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { state, download, install } = useUpdater()

  if (!['update-available', 'downloading', 'downloaded'].includes(state.state)) {
    return null
  }

  const isDownloading = state.state === 'downloading'
  const isDownloaded = state.state === 'downloaded'

  // Sidebar has no percent display; the collapsed pill always shows the
  // indeterminate "Updating…" label while downloading (R5).
  const label = isDownloading
    ? t('updater.sidebar.downloadingIndeterminate')
    : isDownloaded
      ? t('updater.sidebar.restart')
      : t('updater.sidebar.update')

  const suffix = state.failure ? ` ${t('updater.sidebar.retrySuffix')}` : ''

  const ariaLabel = isDownloading
    ? t('updater.sidebar.downloadingAria', { percent: state.progressPercent })
    : isDownloaded
      ? t('updater.sidebar.restartAria')
      : t('updater.sidebar.downloadAria') + suffix

  const title = isDownloading
    ? ariaLabel
    : isDownloaded
      ? t('updater.sidebar.restartTitle')
      : t('updater.sidebar.downloadTitle') + suffix

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
      title={title}
      aria-disabled={isDownloading}
      // VRX-255 footer grid: top-[14px] = the footer's pt-[12px] + ~2px line-box lead
      // above the 16px mono wordmark's cap — the button's top edge sits on the
      // wordmark top and its 36px height lands the bottom edge on the version
      // line's bottom (render-measured 0px deltas, both themes). Re-measure if
      // the footer padding, wordmark size, or font changes.
      className={[
        'group absolute right-[10px] top-[14px]',
        'flex items-center justify-start',
        'h-[36px] w-[36px] hover:w-[104px] focus-visible:w-[104px]',
        'rounded-full border border-[var(--border)]',
        'bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)]',
        'text-[var(--text)]',
        'focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)]',
        'pl-[9px] pr-0 hover:pr-[12px] focus-visible:pr-[12px]',
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
  { id: 'hot', icon: IconHot },
  { id: 'friends', icon: IconFriends },
  { id: 'explore', icon: IconExplore },
  { id: 'settings', icon: IconSettings }
]

export default function Sidebar(): React.JSX.Element {
  const { t } = useTranslation()
  const activeTab = useUiStore((s) => s.activeTab)
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  const platformFilter = useFriendsStore((s) => s.platformFilter)
  const showHotInstancesPage = useSettingsStore((s) => s.settings.showHotInstancesPage)
  const showExplorePage = useSettingsStore((s) => s.settings.showExplorePage)
  const navItems = NAV_ITEMS.filter(({ id }) =>
    isPageShown(id, { showHotInstancesPage, showExplorePage })
  )

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
        {navItems.map(({ id, icon: Icon }) => {
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

      {/* Footer (§8). While the update button shows, the text keeps clear of
          it (right-[10px] + w-[36px]); a long prerelease version wraps whole
          instead of running under the button. */}
      <div
        className="relative text-[11px] text-[var(--text-faint)] pt-[12px] mt-[12px] has-[>button]:pr-[46px]"
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
        {t('shell.footer')} · <span className="whitespace-nowrap">v{__APP_VERSION__}</span>
      </div>
    </aside>
  )
}
