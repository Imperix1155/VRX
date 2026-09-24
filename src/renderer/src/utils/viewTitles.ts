import type { ActiveTab } from '../stores/ui'

/**
 * View-title i18n keys, keyed by nav tab. Consumed by TopBar (the H1) and
 * AppShell (the `<main>` landmark's aria-label — audit W5). Lives here rather
 * than in a component file so react-refresh keeps component-only exports.
 */
export const VIEW_TITLE_KEYS: Record<ActiveTab, string> = {
  dashboard: 'shell.nav.dashboard',
  friends: 'shell.nav.friends',
  explore: 'shell.nav.explore',
  settings: 'shell.nav.settings'
}
