import { useTranslation } from 'react-i18next'
import { useUiStore, type ActiveTab } from '../stores/ui'

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
              {/* Left spine gradient — active only (§8: --vrc → --cvr) */}
              {isActive && (
                <span
                  className="absolute left-[-16px] w-[3px] h-[20px] rounded-[2px]"
                  style={{ background: 'linear-gradient(var(--vrc), var(--cvr))' }}
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
        className="text-[11px] text-[var(--text-faint)] pt-[12px] mt-[12px]"
        style={{ borderTop: '1px solid var(--sidebar-foot-border)' }}
      >
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
