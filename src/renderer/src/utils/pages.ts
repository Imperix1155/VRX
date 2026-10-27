import type { Settings } from '@shared/settings'
import type { ActiveTab } from '../stores/ui'

/** The page switches a user can turn off (owner, 2026-10-20). Dashboard,
 *  Friends and Settings always show, so VRX can never hide its way out. */
export type PageVisibility = Pick<
  Settings,
  'showHotInstancesPage' | 'showExplorePage' | 'showActivityPage'
>

export function isPageShown(tab: ActiveTab, pages: PageVisibility): boolean {
  if (tab === 'hot') return pages.showHotInstancesPage
  if (tab === 'explore') return pages.showExplorePage
  if (tab === 'activity') return pages.showActivityPage
  return true
}
