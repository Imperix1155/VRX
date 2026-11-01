import type { FriendActionFailure } from '@shared/friendActions'

/** What each refusal says; `{{platform}}` is the platform's name. Quoted
 *  literals keep the locale parity scan aware of these keys. */
export const FRIEND_ACTION_ERROR_KEYS: Record<FriendActionFailure, string> = {
  'not-authenticated': 'friendActions.error.not-authenticated',
  'rate-limited': 'friendActions.error.rate-limited',
  unavailable: 'friendActions.error.unavailable',
  busy: 'friendActions.error.busy',
  refused: 'friendActions.error.refused',
  'unknown-request': 'friendActions.error.unknown-request',
  'unknown-person': 'friendActions.error.unknown-person',
  'already-friends': 'friendActions.error.already-friends'
}

/** The one filled button of a friend action (Accept, Add friend). */
export const FRIEND_ACTION_BUTTON = [
  'shrink-0 rounded-control border border-[var(--control-active-border)] bg-[var(--control-fill-hover)]',
  'px-[var(--space-3)] py-[var(--space-1)] text-xs font-semibold text-[var(--text)]',
  'hover:brightness-110 active:brightness-95',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-dim)]',
  'disabled:cursor-default disabled:opacity-60 motion-safe:transition-[filter] cursor-pointer'
].join(' ')
