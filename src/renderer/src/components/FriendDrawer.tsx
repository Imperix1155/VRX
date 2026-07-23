/**
 * FriendDrawer — the friend-details drawer (VRX-69 phase 1, owner-approved
 * design round 2026-07-17, mock rev d3).
 *
 * A floating `.glass` card pinned to the right edge (14px top/right/bottom
 * inset, 372px wide, panel-scale 20px radius from `.glass` itself) over a
 * `--scrim` backdrop; slides in/out over 260ms cubic-bezier(.32,.72,.29,1),
 * `motion-safe:` guarded. Stays mounted while closed (translated off-screen,
 * `inert` + aria-hidden) so the exit transition can play.
 *
 * Phase 1 content — ONLY sections with real data today:
 *   1. Header: 64px ringed avatar (no corner badge) · name 18/700 · custom
 *      status (VRChat only) · ghost platform pill (full platform word).
 *   2. Status band — the HEADLINE: the privacy tier in WORDS (word + dot in
 *      the status token, dim right-aligned descriptor). This is the drawer's
 *      §5/R12 non-color signifier now that the row badge lost its glyph.
 *      Reuses `ringFor` (utils/statusRing) — CVR online folds to tier-2 Online.
 *   3. WHERE: world name + the SHARED InstancePill (same tier logic as the
 *      row); Ask Me/DND show "Hidden"; VRChat trust line when known.
 *   4. Actions: ONE primary Join button, only when `isFriendJoinable` — same
 *      bridge flow + in-flight guard + 2.5s failure blip as the row (VRX-166).
 *      Copy link / self-invite / favorite / notes are SEPARATE issues; no
 *      placeholders here.
 *
 * NON-MODAL since VRX-225 (owner live session 2026-07-23): the list behind the
 * card stays fully interactive — the soft scrim (`--scrim-soft`) is
 * pointer-events-none pure depth, there is NO focus trap and NO aria-modal,
 * and clicking another friend's avatar SWITCHES the card in place. Close
 * paths: ✕, Esc, or any pointerdown outside the panel that isn't on a
 * `[data-drawer-opener]` (the avatar buttons — those switch, never close).
 * Initial focus lands on ✕ when a friend is first selected; focus returns to
 * the opening row on close (owner of that contract is FriendsList's
 * `closeDrawer`).
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Friend, TrustRank } from '@shared/types'
import { isFriendJoinable } from '@shared/joinability'
import { useJoinInstance } from '../hooks/useJoinInstance'
import { useFriendNote } from '../hooks/useFriendNote'
import { useSettingsStore } from '../stores/settings'
import { LABEL_KEYS_BY_SCHEME } from '../utils/instanceTypeLabels'
import { OPENNESS_TIER, type OpennessTier } from '../utils/instancePill'
import { ringFor, isWorldHidden } from '../utils/statusRing'
import InstancePill from './InstancePill'
import { Avatar } from './Avatar'

/** Status-band descriptor per ring label (quoted literals so the i18n
 *  key-existence scan sees them). Web-active has no owner-approved descriptor
 *  in phase 1 — the band then shows the word alone. */
const STATUS_DESCRIPTOR_KEY: Record<string, string> = {
  'friends.status.joinMe': 'drawer.statusDesc.joinMe',
  'friends.status.online': 'drawer.statusDesc.online',
  'friends.status.askMe': 'drawer.statusDesc.askMe',
  'friends.status.dnd': 'drawer.statusDesc.dnd',
  'friends.presence.offline': 'drawer.statusDesc.offline'
}

/** Trust-rank i18n keys (quoted-literal map for the parity scan). */
const TRUST_RANK_KEY: Record<NonNullable<TrustRank>, string> = {
  visitor: 'drawer.trustRank.visitor',
  new: 'drawer.trustRank.new',
  user: 'drawer.trustRank.user',
  known: 'drawer.trustRank.known',
  trusted: 'drawer.trustRank.trusted',
  nuisance: 'drawer.trustRank.nuisance'
}

export default function FriendDrawer({
  friend,
  onClose
}: {
  /** The selected friend, or null = closed. */
  friend: Friend | null
  /** Close request (Esc / outside pointerdown / ✕). Focus restoration lives with the caller. */
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const labelScheme = useSettingsStore((s) => s.settings.labelScheme)
  const open = friend !== null
  // Retain the last friend so the panel doesn't empty mid slide-out
  // (render-phase state adjustment — the react.dev-endorsed pattern).
  const [retained, setRetained] = useState<Friend | null>(null)
  if (friend !== null && friend !== retained) setRetained(friend)
  const shown = friend ?? retained

  const panelRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  // Shared join flow — the SAME implementation as the row pill (VRX-166).
  const { isJoining, joinFailedFor, join } = useJoinInstance()

  // Esc closes while open; initial focus lands on the ✕ button. NO focus trap
  // (VRX-225): the dialog is non-modal — Tab moves freely between the card and
  // the still-interactive list behind it. Trapping focus while the background
  // accepts pointer input would make keyboard and mouse users live in two
  // different interaction models, which is worse than either alone.
  useEffect(() => {
    if (!open) return
    closeButtonRef.current?.focus()
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  // Outside pointerdown closes (VRX-225) — except on a `[data-drawer-opener]`
  // (an avatar button): those SWITCH the card to that friend, and letting this
  // listener also fire would close-then-reopen, flickering the slide animation.
  // pointerdown (not click) so a drag that starts outside doesn't count as a
  // click-through on release, and so the close wins before a row's hover
  // effects react.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent): void {
      const target = event.target
      if (!(target instanceof Element)) return
      if (panelRef.current?.contains(target)) return
      if (target.closest('[data-drawer-opener]')) return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, onClose])

  // ── Derived content (mirrors the row's logic — single source in utils) ────
  const ring = shown ? ringFor(shown) : null
  const sc = ring?.colorVar ?? '--offline'
  // Status word color: the --st-* tokens have darker light-mode companions
  // (§2A law — light status text MUST use them; identical to the hue in dark).
  const wordColor = sc.startsWith('--st-') ? `var(${sc}-text)` : `var(${sc})`
  const descriptorKey = ring ? STATUS_DESCRIPTOR_KEY[ring.labelKey] : undefined

  const hideWorld = shown ? isWorldHidden(shown) : false
  let worldText: string | null = null
  let pillLabel: string | null = null
  let pillTier: OpennessTier | null = null
  if (shown) {
    if (hideWorld) {
      worldText = t('drawer.hidden')
    } else if (shown.instance != null) {
      worldText = shown.instance.worldName ?? t('friends.instance.unknownWorld')
      pillLabel = t(
        LABEL_KEYS_BY_SCHEME[labelScheme][shown.instance.type] ?? 'friends.instance.unknownWorld'
      )
      pillTier = OPENNESS_TIER[shown.instance.type] ?? null
    } else if (shown.presence.state === 'in-game') {
      worldText = t('friends.instance.private')
    }
  }
  const trustKey =
    shown?.platform === 'vrchat' && shown.trustRank != null ? TRUST_RANK_KEY[shown.trustRank] : null
  const customStatus = shown?.platform === 'vrchat' ? (shown.statusDescription ?? null) : null
  const joinable = shown != null && isFriendJoinable(shown)
  const isVrc = shown?.platform === 'vrchat'

  const {
    value: noteValue,
    setValue: setNoteValue,
    onBlur: onNoteBlur
  } = useFriendNote({
    platform: shown?.platform ?? 'vrchat',
    friendId: shown?.platformUserId ?? ''
  })

  return (
    <div inert={!open} aria-hidden={!open}>
      {/* Soft scrim — pure depth, NEVER an input surface (pointer-events-none
          in both states): the list behind stays hoverable and clickable
          (VRX-225). Outside-close lives on a document listener instead. */}
      <div
        data-testid="friend-drawer-scrim"
        aria-hidden="true"
        className={`pointer-events-none fixed inset-0 z-40 bg-[var(--scrim-soft)] motion-safe:transition-opacity motion-safe:duration-[260ms] ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {/* Non-modal dialog (no aria-modal): the background is genuinely
          interactive, and claiming modality to assistive tech while pointer
          users can reach the list would be a lie (VRX-225). */}
      <div
        ref={panelRef}
        role="dialog"
        aria-label={shown?.displayName}
        className={`glass fixed top-[14px] right-[14px] bottom-[14px] z-50 flex w-[372px] flex-col motion-safe:transition-transform motion-safe:duration-[260ms] motion-safe:ease-[cubic-bezier(0.32,0.72,0.29,1)] ${
          open ? 'translate-x-0' : 'translate-x-[calc(100%+14px)]'
        }`}
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label={t('drawer.close')}
          className="absolute top-[var(--space-3)] right-[var(--space-3)] z-10 grid h-[28px] w-[28px] place-items-center rounded-[9px] text-base leading-none text-[var(--text-dim)] hover:bg-[var(--surface-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors"
        >
          <span aria-hidden="true">✕</span>
        </button>

        {shown && (
          <div className="flex min-h-0 flex-1 flex-col gap-[var(--space-4)] overflow-y-auto p-[var(--space-4)]">
            {/* 1 · Header */}
            <div className="flex items-center gap-[var(--space-3)] pr-[var(--space-8)]">
              <Avatar friend={shown} variant="drawer" />
              <div className="min-w-0">
                <h2 className="truncate text-[18px] font-bold text-[var(--text)]">
                  {shown.displayName}
                </h2>
                {customStatus && (
                  <p className="truncate text-[12.5px] text-[var(--text-dim)]">{customStatus}</p>
                )}
                <span
                  className="mt-[var(--space-1)] inline-flex h-[24px] items-center rounded-[9px] border bg-transparent px-[var(--space-2-5)] text-[11px] font-semibold"
                  style={{
                    color: isVrc ? 'var(--plat-vrc-ghost-text)' : 'var(--plat-cvr-ghost-text)',
                    borderColor: isVrc
                      ? 'var(--plat-vrc-ghost-border)'
                      : 'var(--plat-cvr-ghost-border)'
                  }}
                >
                  {isVrc ? t('friends.platform.vrchat') : t('friends.platform.chilloutvr')}
                </span>
              </div>
            </div>

            {/* 2 · Status band — the privacy tier in WORDS (the headline). */}
            <div
              className="flex items-center gap-[var(--space-2)] rounded-[10px] border px-[var(--space-3)] py-[var(--space-2)]"
              style={{
                borderColor: `color-mix(in srgb, var(${sc}) 30%, transparent)`,
                background: `color-mix(in srgb, var(${sc}) 10%, transparent)`
              }}
            >
              <span
                aria-hidden="true"
                className="h-[10px] w-[10px] shrink-0 rounded-full"
                style={{ background: `var(${sc})` }}
              />
              <span className="text-[14px] font-bold" style={{ color: wordColor }}>
                {ring ? t(ring.labelKey) : null}
              </span>
              {descriptorKey && (
                <span className="ml-auto text-right text-[12px] text-[var(--text-dim)]">
                  {t(descriptorKey)}
                </span>
              )}
            </div>

            {/* 3 · WHERE */}
            {(worldText != null || trustKey != null) && (
              <div className="flex flex-col gap-[var(--space-1)]">
                <h3 className="text-[10.5px] font-semibold tracking-widest text-[var(--text-dim)] uppercase">
                  {t('drawer.where')}
                </h3>
                {worldText != null && (
                  <div className="flex items-center justify-between gap-[var(--space-2)]">
                    <span className="min-w-0 truncate text-[14px] font-semibold text-[var(--text)]">
                      {worldText}
                    </span>
                    {pillLabel != null && (
                      <InstancePill label={pillLabel} tier={pillTier} className="shrink-0" />
                    )}
                  </div>
                )}
                {trustKey != null && (
                  <p className="text-[12px] text-[var(--text-dim)]">
                    {t('drawer.trust', { rank: t(trustKey) })}
                  </p>
                )}
              </div>
            )}

            {/* 4 · Actions — phase 1 = the one real action. */}
            {joinable && (
              <div className="flex flex-col gap-[var(--space-1)]">
                <button
                  type="button"
                  onClick={() => {
                    if (shown) void join(shown)
                  }}
                  disabled={isJoining}
                  className="w-full rounded-control border px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold hover:brightness-110 active:brightness-95 focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] disabled:cursor-default disabled:opacity-50 motion-safe:transition-[filter]"
                  style={{
                    borderColor: 'color-mix(in srgb, var(--op-public) 45%, transparent)',
                    background: 'color-mix(in srgb, var(--op-public) 16%, transparent)',
                    color: 'var(--op-public-text)'
                  }}
                >
                  {t('drawer.join')}
                </button>
                <span
                  role="status"
                  className="block min-h-[16px] text-center text-[12px] text-[var(--text-dim)]"
                >
                  {shown && joinFailedFor(shown) ? t('friends.joinFailed') : ''}
                </span>
              </div>
            )}

            {/* 5 · Notes — private, account-scoped (VRX-72). */}
            {shown && (
              <div className="flex flex-col gap-[var(--space-1)]">
                <h3
                  id="friend-notes-label"
                  className="text-[10.5px] font-semibold tracking-widest text-[var(--text-dim)] uppercase"
                >
                  <label htmlFor="friend-notes">{t('drawer.notes.heading')}</label>
                </h3>
                <textarea
                  id="friend-notes"
                  value={noteValue}
                  onChange={(event) => setNoteValue(event.target.value)}
                  onBlur={onNoteBlur}
                  maxLength={500}
                  rows={4}
                  placeholder={t('drawer.notes.placeholder')}
                  aria-labelledby="friend-notes-label"
                  className="w-full resize-none rounded-control border bg-[var(--control-fill)] px-[var(--space-3)] py-[var(--space-2)] text-[13px] text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] disabled:cursor-default disabled:opacity-50"
                  style={{ borderColor: 'var(--border)' }}
                />
                <span
                  aria-live="polite"
                  className="text-right text-[11px] text-[var(--text-faint)]"
                >
                  {t('drawer.notes.counter', { current: noteValue.length })}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
