import type { Settings } from '@shared/settings'
import type { DashboardSection } from '@shared/types'

type ShowSetting = keyof Pick<
  Settings,
  'dashboardWearingNow' | 'dashboardInvites' | 'dashboardPopularNow' | 'hotInstancesEnabled'
>

/** Each Dashboard section's name and the setting that shows it, for
 *  Settings → Dashboard and the welcome setup's summary. */
export const SECTION_SETTINGS: Readonly<
  Record<DashboardSection, { labelKey: string; setting: ShowSetting }>
> = {
  'wearing-now': {
    labelKey: 'settings.dashboard.wearingNow.label',
    setting: 'dashboardWearingNow'
  },
  invites: { labelKey: 'settings.dashboard.invites.label', setting: 'dashboardInvites' },
  popular: { labelKey: 'settings.dashboard.popular.label', setting: 'dashboardPopularNow' },
  hot: { labelKey: 'settings.dashboard.hot.label', setting: 'hotInstancesEnabled' }
}
