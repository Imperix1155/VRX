/**
 * Inbox page (owner, 2026-10-27): invites, invite requests and friend requests
 * the platform sockets delivered while VRX was open, for both platforms alike.
 *
 * View-only by design. Answering stays in the game or on the platform's site;
 * Hide only takes a row out of VRX and sends nothing. Rows follow the platform
 * filter, carry the platform as a word (PlatformPill) beside its color, and
 * show a known friend's current name and picture. The TopBar owns the heading.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { InboxItem, InboxKind } from '@shared/inbox'
import type { Friend, Platform } from '@shared/types'
import { useInbox, dismissInboxItem, clearInbox } from '../queries/inbox'
import { useFriends } from '../queries/friends'
import { useNotConnectedGate } from '../hooks/useNotConnectedGate'
import { useAvatar } from '../hooks/useAvatar'
import { useFriendsStore } from '../stores/friends'
import { useUiStore } from '../stores/ui'
import { NOT_CONNECTED_KEY } from '../utils/notConnectedKeys'
import { inboxActionText, relativeInboxTime, scopeInboxItems } from '../utils/inbox'
import PlatformPill from './PlatformPill'

/** Ages refresh once a minute while the page is open; no data is read. */
const AGE_TICK_MS = 60_000

const graphemes = new Intl.Segmenter()

function initialOf(name: string): string {
  const first = graphemes.segment(name.trim())[Symbol.iterator]().next()
  return first.done === true ? '?' : first.value.segment.toUpperCase()
}

const HIDE_ARIA_KEYS: Record<InboxKind, string> = {
  invite: 'inbox.hideInviteAria',
  'invite-request': 'inbox.hideInviteRequestAria',
  'friend-request': 'inbox.hideFriendRequestAria'
}

/** A friend's own picture when the sender is one, else their initial. No
 *  presence ring: the inbox is about the message, not where they are. The
 *  Dashboard's latest-invite rows use it too. */
export function InboxAvatar({
  name,
  friend
}: {
  name: string
  friend: Friend | undefined
}): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const dataUrl = useAvatar(friend?.avatarUrl ?? null, ref, 'avatar')
  const [failed, setFailed] = useState<string | null>(null)
  return (
    <span ref={ref} aria-hidden="true" className="block h-[36px] w-[36px] shrink-0">
      {dataUrl && dataUrl !== failed ? (
        <img
          src={dataUrl}
          alt=""
          onError={() => setFailed(dataUrl)}
          className="h-[36px] w-[36px] rounded-full object-cover"
        />
      ) : (
        <span className="grid h-[36px] w-[36px] place-items-center rounded-full text-sm font-semibold text-[var(--text-dim)] bg-[color-mix(in_srgb,var(--text)_10%,transparent)]">
          {initialOf(name)}
        </span>
      )}
    </span>
  )
}

const QUIET_BUTTON = [
  'shrink-0 rounded-control px-[var(--space-3)] py-[var(--space-1)] text-xs font-medium',
  'text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-dim)]',
  'disabled:cursor-default disabled:opacity-50 motion-safe:transition-colors cursor-pointer'
].join(' ')

export default function InboxView(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const inbox = useInbox()
  const vrcFriends = useFriends('vrchat')
  const cvrFriends = useFriends('chilloutvr')
  const platformFilter = useFriendsStore((s) => s.platformFilter)
  const markInboxSeen = useUiStore((s) => s.markInboxSeen)
  const { selectedPlatform, isAuthStatusPending, isNotConnected, openAccounts } =
    useNotConnectedGate(platformFilter)
  const [helpOpen, setHelpOpen] = useState(false)
  const [hideFailed, setHideFailed] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const helpId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const helpButtonRef = useRef<HTMLButtonElement>(null)
  /** The hidden rows and the place focus should land once they are gone. */
  const focusAfterHide = useRef<{ ids: Set<string>; index: number } | null>(null)

  const items = useMemo(
    () => scopeInboxItems(inbox.data?.items ?? [], platformFilter),
    [inbox.data, platformFilter]
  )
  const { invites, requests, ordered } = useMemo(() => {
    const invites = items.filter((item) => item.kind !== 'friend-request')
    const requests = items.filter((item) => item.kind === 'friend-request')
    // Section order is the visual order; focus recovery walks the same list.
    return { invites, requests, ordered: [...invites, ...requests] }
  }, [items])

  const friendsById = useMemo(() => {
    const byPlatform: Record<Platform, Map<string, Friend>> = {
      vrchat: new Map((vrcFriends.data ?? []).map((f) => [f.platformUserId, f])),
      chilloutvr: new Map((cvrFriends.data ?? []).map((f) => [f.platformUserId, f]))
    }
    return byPlatform
  }, [vrcFriends.data, cvrFriends.data])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), AGE_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  // Everything on screen counts as seen, per platform.
  useEffect(() => {
    for (const platform of ['vrchat', 'chilloutvr'] as const) {
      const newest = items.find((item) => item.platform === platform)
      if (newest) markInboxSeen(platform, newest.receivedAt)
    }
  }, [items, markInboxSeen])

  // After a row leaves, keep keyboard focus in the list: the row that took its
  // place, the one above, or the help button when the list emptied.
  useEffect(() => {
    const pending = focusAfterHide.current
    if (pending === null || ordered.some((row) => pending.ids.has(`${row.platform}:${row.id}`)))
      return
    focusAfterHide.current = null
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[data-inbox-hide]')
    const target = buttons?.[Math.min(pending.index, buttons.length - 1)]
    ;(target ?? helpButtonRef.current)?.focus()
  }, [ordered])

  const nameOf = (item: InboxItem): string =>
    friendsById[item.platform].get(item.senderId)?.displayName ??
    item.senderName ??
    t('inbox.someone')

  const hide = async (item: InboxItem): Promise<void> => {
    const index = Math.max(
      0,
      ordered.findIndex((row) => row.id === item.id)
    )
    focusAfterHide.current = { ids: new Set([`${item.platform}:${item.id}`]), index }
    const ok = await dismissInboxItem(item.platform, item.id)
    if (!ok) focusAfterHide.current = null
    setHideFailed(!ok)
  }

  const hideAll = async (): Promise<void> => {
    const platforms = [...new Set(items.map((item) => item.platform))]
    focusAfterHide.current = {
      ids: new Set(items.map((item) => `${item.platform}:${item.id}`)),
      index: 0
    }
    const ok = await clearInbox(platforms)
    if (!ok) focusAfterHide.current = null
    setHideFailed(!ok)
  }

  if (isAuthStatusPending) {
    return <p className="text-sm text-[var(--text-dim)]">{t('dashboard.loading')}</p>
  }
  if (isNotConnected) {
    return (
      <div className="glass glass-information flex flex-col items-center justify-center gap-[var(--space-3)] p-[var(--space-10)] text-center min-h-[180px]">
        <p className="text-sm font-semibold text-[var(--text-dim)]">
          {selectedPlatform === null ? null : t(NOT_CONNECTED_KEY.inbox[selectedPlatform])}
        </p>
        <button
          type="button"
          onClick={openAccounts}
          className="rounded-control px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--text)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] motion-safe:transition-colors"
        >
          {t('dashboard.notConnected.openAccounts')}
        </button>
      </div>
    )
  }
  if (inbox.isError && inbox.data === undefined) {
    return (
      <div className="flex items-center gap-[var(--space-3)]">
        <p className="text-sm text-[var(--error)]">{t('inbox.loadError')}</p>
        <button
          type="button"
          onClick={() => void inbox.refetch()}
          className="rounded-control px-[var(--space-2)] py-[var(--space-1)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-hover)] motion-safe:transition-colors"
        >
          {t('dashboard.retry')}
        </button>
      </div>
    )
  }

  const section = (headingKey: string, rows: InboxItem[]): React.JSX.Element | null => {
    if (rows.length === 0) return null
    return (
      <section aria-label={t(headingKey)} className="flex flex-col gap-[var(--space-2)]">
        <h2 className="canvas-text px-[var(--space-1)] text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-dim)]">
          {t(headingKey)}
        </h2>
        <ul className="flex flex-col gap-[6px]">
          {rows.map((item) => {
            const name = nameOf(item)
            const age = relativeInboxTime(item.receivedAt, now, i18n.language) ?? t('inbox.justNow')
            return (
              <li
                key={`${item.platform}:${item.id}`}
                className={`platform-row platform-row--${item.platform} flex items-center gap-[var(--space-3)] px-[var(--space-4)] py-[var(--space-3)]`}
              >
                <InboxAvatar name={name} friend={friendsById[item.platform].get(item.senderId)} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-[var(--space-2)]">
                    <span
                      className="truncate text-sm font-semibold text-[var(--text)]"
                      title={name}
                    >
                      {name}
                    </span>
                    <PlatformPill platform={item.platform} className="shrink-0" />
                  </div>
                  <p className="mt-[var(--space-0-5)] text-xs text-[var(--text-dim)]">
                    <span className="break-words">{inboxActionText(item, t)}</span>
                    <span aria-hidden="true"> · </span>
                    <time dateTime={new Date(item.receivedAt).toISOString()}>{age}</time>
                  </p>
                </div>
                <button
                  type="button"
                  data-inbox-hide=""
                  onClick={() => void hide(item)}
                  aria-label={t(HIDE_ARIA_KEYS[item.kind], { name })}
                  className={QUIET_BUTTON}
                >
                  {t('inbox.hide')}
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    )
  }

  return (
    <div ref={listRef} className="flex flex-col gap-[var(--space-4)]">
      <div className="flex items-center justify-between gap-[var(--space-4)]">
        <p className="canvas-text text-sm text-[var(--text-dim)]" aria-live="polite">
          {items.length > 0 ? t('inbox.count', { count: items.length }) : null}
        </p>
        <div className="flex shrink-0 items-center gap-[var(--space-2)]">
          {items.length > 0 ? (
            <button
              type="button"
              onClick={() => void hideAll()}
              className={`canvas-text ${QUIET_BUTTON}`}
            >
              {t('inbox.hideAll')}
            </button>
          ) : null}
          <button
            ref={helpButtonRef}
            type="button"
            aria-label={t('inbox.help.label')}
            title={t('inbox.help.label')}
            aria-expanded={helpOpen}
            aria-controls={helpId}
            onClick={() => setHelpOpen((open) => !open)}
            className="glass grid h-[var(--space-8)] w-[var(--space-8)] shrink-0 place-items-center rounded-full text-sm font-semibold text-[var(--text-dim)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-dim)]"
          >
            <span aria-hidden="true">?</span>
          </button>
        </div>
      </div>
      <div
        id={helpId}
        hidden={!helpOpen}
        className="glass glass-information p-[var(--space-4)] text-sm leading-relaxed text-[var(--text-dim)]"
      >
        <p>{t('inbox.help.answer')}</p>
        <p className="mt-[var(--space-2)]">{t('inbox.help.live')}</p>
      </div>
      {hideFailed ? (
        <p role="alert" className="text-sm text-[var(--error)]">
          {t('inbox.hideFailed')}
        </p>
      ) : null}
      {items.length === 0 ? (
        <div className="glass glass-information flex flex-col items-center justify-center text-center p-[var(--space-10)] min-h-[180px]">
          <p className="text-sm font-semibold text-[var(--text-dim)]">{t('inbox.emptyHeading')}</p>
          <p className="mt-[var(--space-1)] text-xs text-[var(--text-dim)]">
            {t('inbox.emptyHint')}
          </p>
        </div>
      ) : (
        <>
          {section('inbox.invitesHeading', invites)}
          {section('inbox.requestsHeading', requests)}
        </>
      )}
    </div>
  )
}
