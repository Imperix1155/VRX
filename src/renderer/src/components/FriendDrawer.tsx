/**
 * FriendDrawer: account and linked-person details (VRX-69/143).
 *
 * A floating `.glass glass-frosted` card pinned to the right edge (14px
 * top/right/bottom inset, 372px wide, panel-scale 20px radius from `.glass`
 * itself) over a
 * `--scrim` backdrop; slides in/out over 260ms cubic-bezier(.32,.72,.29,1),
 * `motion-safe:` guarded. Stays mounted while closed (translated off-screen,
 * `inert` + aria-hidden) so the exit transition can play. The `glass-frosted`
 * variant (VRX-226) adds an opaque underlay + stronger blur: the panel floats
 * OVER the live friend list, so base glass let row text read through it.
 *
 * Content uses the selected person or explicitly selected account:
 *   1. Header: 64px ringed avatar, name, attributed status and platform identity.
 *   2. Status band — the HEADLINE: the privacy tier in WORDS (word + dot in
 *      the status token, dim right-aligned descriptor). This is the drawer's
 *      §5/R12 non-color signifier now that the row badge lost its glyph.
 *      Reuses `ringFor` (utils/statusRing) — CVR online folds to tier-2 Online.
 *   3. Where: one world card or a diagonal pair, canonical InstancePill and
 *      privacy-safe Hidden layers. No policy-space pill or raw instance ID here.
 *   4. Join: linked people choose a reviewed destination before the existing
 *      bridge flow, confirmation and in-flight guard (VRX-166).
 *      Copy link / self-invite / favorite remain separate issues; no
 *      placeholders here.
 *   5. Notes: person-shared or account-private owner, save-on-blur/navigation,
 *      explicit Retry after failure, then quiet VRChat trust when known.
 *
 * NON-MODAL since VRX-225 (owner live session 2026-07-23): the list behind the
 * card stays fully interactive — the soft scrim (`--scrim-soft`) is
 * pointer-events-none pure depth, there is NO focus trap and NO aria-modal,
 * and clicking another friend's avatar (or, in the default 'card' opener mode,
 * VRX-228, anywhere on another friend's row) SWITCHES the card in place. Close
 * paths: ✕, Esc, or any pointerdown outside the panel that isn't on a
 * `[data-drawer-opener]` — except a `[data-join-pill]`, which is never part of
 * the opener surface (join wins over open; the card closes, then the click
 * joins).
 * Initial focus lands on ✕ when a friend is first selected; focus returns to
 * the opening row on close (owner of that contract is FriendsList's
 * `closeDrawer`).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Friend, Platform, TrustRank } from '@shared/types'
import { isFriendJoinable } from '@shared/joinability'
import { joinFailureMessageKey, useJoinInstance } from '../hooks/useJoinInstance'
import { useFriendNote } from '../hooks/useFriendNote'
import { usePersonNote } from '../hooks/usePersonNote'
import { ringFor } from '../utils/statusRing'
import { Avatar } from './Avatar'
import LinkedWorlds from './LinkedWorlds'
import LinkedDestinationChooser from './LinkedDestinationChooser'
import type { ProfileTarget, ResolvedProfile } from '../utils/projectLinkedFriends'
import IdentitiesDialog from './IdentitiesDialog'

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
  onClose,
  selection,
  onNavigate,
  friends,
  accountIds,
  available
}: {
  /** The selected friend, or null = closed. */
  friend: Friend | null
  /** Close request (Esc / outside pointerdown / ✕). Focus restoration lives with the caller. */
  onClose: () => void
  selection?: ResolvedProfile | null
  onNavigate?: (target: ProfileTarget) => void
  friends?: Friend[]
  accountIds?: Partial<Record<Platform, string>>
  available?: Partial<Record<Platform, boolean>>
}): React.JSX.Element {
  const { t } = useTranslation()
  const open = friend !== null
  // Retain the last friend so the panel doesn't empty mid slide-out
  // (render-phase state adjustment — the react.dev-endorsed pattern).
  const [retained, setRetained] = useState<Friend | null>(null)
  if (friend !== null && friend !== retained) setRetained(friend)
  const shown = friend ?? retained
  const combined = selection?.target.kind === 'person'
  const shownAccounts = combined ? selection.accounts : shown ? [shown] : []
  const profileName = selection?.name ?? shown?.displayName
  const identityOwner =
    selection?.target.kind === 'person'
      ? `person:${selection.target.personId}`
      : selection?.target.kind === 'account'
        ? `${selection.target.account.platform}:${selection.target.account.friendId}`
        : null
  const [identityDialogOwner, setIdentityDialogOwner] = useState<string | null>(null)
  const [chooserOwner, setChooserOwner] = useState<string | null>(null)
  if (chooserOwner !== null && (!open || chooserOwner !== identityOwner)) setChooserOwner(null)
  if (identityDialogOwner !== null && (!open || identityDialogOwner !== identityOwner))
    setIdentityDialogOwner(null)

  const panelRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  // Shared join flow — the SAME implementation as the row pill (VRX-166).
  const { isJoining, joinFailureFor, join, pendingConfirm } = useJoinInstance()
  const joinFailure = shownAccounts.map(joinFailureFor).find((reason) => reason !== null)

  // Initial focus lands on the ✕ button — keyed on `open` ONLY. Never fold
  // this into the listener effect below: `pendingConfirm` changes (the join
  // dialog opening/closing) would re-run it and steal focus back to ✕,
  // overriding the dialog's own focus restoration (VRX-210 regression pin).
  useEffect(() => {
    if (!open) return
    closeButtonRef.current?.focus()
  }, [open])

  // Esc closes while open. NO focus trap
  // (VRX-225): the dialog is non-modal — Tab moves freely between the card and
  // the still-interactive list behind it. Trapping focus while the background
  // accepts pointer input would make keyboard and mouse users live in two
  // different interaction models, which is worse than either alone.
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent): void {
      // VRX-210: while the join confirmation dialog is parked, Esc belongs to
      // IT — the dialog is a TRUE modal sibling (AppShell), not inside this
      // panel, so without the guard every dialog Esc would also close the drawer.
      if (pendingConfirm !== null) return
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose, pendingConfirm])

  // Outside pointerdown closes (VRX-225) — except on a `[data-drawer-opener]`
  // (an avatar button; the whole row in 'card' mode, VRX-228): those SWITCH
  // the card to that friend, and letting this listener also fire would
  // close-then-reopen, flickering the slide animation. A `[data-join-pill]`
  // target is NEVER part of the opener surface — even inside a card-mode row
  // (VRX-228: join wins over open) — so the pill keeps the VRX-225 sequence:
  // the card closes on the pointerdown, then the click joins.
  // pointerdown (not click) so a drag that starts outside doesn't count as a
  // click-through on release, and so the close wins before a row's hover
  // effects react.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent): void {
      // VRX-210: while the modal join dialog is open, NO pointerdown reaches
      // this outside-close — the dialog is not inside panelRef, so clicking
      // Cancel/Join/More info/radios/the footnote would otherwise dismiss the
      // drawer out from under the modal.
      if (pendingConfirm !== null) return
      const target = event.target
      if (!(target instanceof Element)) return
      if (panelRef.current?.contains(target)) return
      if (target.closest('[data-join-pill]') === null && target.closest('[data-drawer-opener]'))
        return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, onClose, pendingConfirm])

  // ── Derived content (mirrors the row's logic — single source in utils) ────
  const ring = shown ? ringFor(shown) : null
  const sc = ring?.colorVar ?? '--offline'
  // Status word color: the --st-* tokens have darker light-mode companions
  // (§2A law — light status text MUST use them; identical to the hue in dark).
  const wordColor = sc.startsWith('--st-') ? `var(${sc}-text)` : `var(${sc})`
  const descriptorKey = ring ? STATUS_DESCRIPTOR_KEY[ring.labelKey] : undefined

  const trustAccount = shownAccounts.find((account) => account.platform === 'vrchat')
  const trustKey = trustAccount?.trustRank != null ? TRUST_RANK_KEY[trustAccount.trustRank] : null
  const customStatus = shown?.platform === 'vrchat' ? (shown.statusDescription ?? null) : null
  const joinable = shownAccounts.some(isFriendJoinable)
  const isVrc = shown?.platform === 'vrchat'

  const accountNote = useFriendNote({
    platform: shown?.platform ?? 'vrchat',
    friendId: combined ? '' : (shown?.platformUserId ?? '')
  })
  const sharedNote = usePersonNote(combined ? (selection.profile?.id ?? null) : null)
  const note = combined ? sharedNote : accountNote
  const {
    value: noteValue,
    isWritable: noteWritable,
    loadFailed: noteLoadFailed,
    retryLoad: retryNoteLoad,
    setValue: setNoteValue,
    onBlur: onNoteBlur,
    saveFailed: noteSaveFailed,
    retry: retryNoteSave
  } = note
  const noteOwner = !open
    ? 'closed'
    : combined
      ? `person:${selection.profile?.id}`
      : `${shown?.platform}:${shown?.platformUserId}`
  const committedNote = useRef(note)
  // Cleanup runs before the next owner's layout effects. Keep the last
  // committed callback, not the new render's callback: navigation must flush
  // the old owner even when removing a focused editor produces no blur.
  useLayoutEffect(() => {
    committedNote.current = note
  })
  useLayoutEffect(() => () => committedNote.current.onBlur(), [noteOwner])
  const notesTextareaRef = useRef<HTMLTextAreaElement>(null)
  const retryNote = (): void => {
    // The Retry button is conditionally removed after success; retain a useful
    // keyboard target before starting the mutation.
    notesTextareaRef.current?.focus()
    if (noteLoadFailed) retryNoteLoad()
    else retryNoteSave()
  }

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
        data-friend-drawer
        role="dialog"
        aria-label={profileName}
        className={`glass glass-frosted fixed top-[14px] right-[14px] bottom-[14px] z-50 flex w-[372px] flex-col motion-safe:transition-transform motion-safe:duration-[260ms] motion-safe:ease-[cubic-bezier(0.32,0.72,0.29,1)] ${
          open ? 'translate-x-0' : 'translate-x-[calc(100%+14px)]'
        }`}
      >
        <button
          ref={closeButtonRef}
          data-drawer-close
          type="button"
          onClick={onClose}
          aria-label={t('drawer.close')}
          className="absolute top-[var(--space-3)] right-[var(--space-3)] z-10 grid h-[28px] w-[28px] place-items-center rounded-[9px] text-base leading-none text-[var(--text-dim)] hover:bg-[var(--surface-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors"
        >
          <span aria-hidden="true">✕</span>
        </button>

        {shown && (
          <div className="flex min-h-0 flex-1 flex-col gap-[var(--space-4)] overflow-y-auto p-[var(--space-4)]">
            {!combined && selection?.profile && onNavigate && (
              <button
                type="button"
                className="self-start text-[12px] text-[var(--text-dim)] hover:text-[var(--text)]"
                onClick={() => {
                  if (selection.target.kind === 'account' && selection.profile)
                    onNavigate({
                      kind: 'person',
                      personId: selection.profile.id,
                      anchor: selection.target.account
                    })
                }}
              >
                {t('linking.back')}
              </button>
            )}
            {/* 1 · Header */}
            <div className="flex items-center gap-[var(--space-3)] pr-[var(--space-8)]">
              <Avatar
                friend={shown}
                variant="drawer"
                mergedWith={
                  combined && selection.profile?.pictureMode === 'merged'
                    ? shownAccounts.find((account) => account.platform !== shown.platform)
                    : undefined
                }
              />
              <div className="min-w-0">
                <h2 className="truncate text-[18px] font-bold text-[var(--text)]">
                  {profileName || t('linking.unknownName')}
                </h2>
                {customStatus && (
                  <p className="truncate text-[12.5px] text-[var(--text-dim)]">{customStatus}</p>
                )}
                {combined && onNavigate ? (
                  <div className="mt-[var(--space-1)] flex gap-[var(--space-2)]">
                    {selection.profile?.members.map((member) => {
                      const available = selection.accounts.some(
                        (account) =>
                          account.platform === member.platform &&
                          account.platformUserId === member.friendId
                      )
                      return (
                        <button
                          key={member.platform}
                          type="button"
                          disabled={!available}
                          title={!available ? t('linking.unavailable') : undefined}
                          className="rounded-pill border px-[var(--space-2)] text-[11px] disabled:opacity-50"
                          style={{
                            color:
                              member.platform === 'vrchat'
                                ? 'var(--plat-vrc-ghost-text)'
                                : 'var(--plat-cvr-ghost-text)',
                            borderColor:
                              member.platform === 'vrchat'
                                ? 'var(--plat-vrc-ghost-border)'
                                : 'var(--plat-cvr-ghost-border)'
                          }}
                          onClick={() =>
                            onNavigate({
                              kind: 'account',
                              personId: selection.profile?.id ?? null,
                              account: { platform: member.platform, friendId: member.friendId }
                            })
                          }
                        >
                          {t(
                            member.platform === 'vrchat'
                              ? 'friends.platform.vrchat'
                              : 'friends.platform.chilloutvr'
                          )}
                        </button>
                      )
                    })}
                  </div>
                ) : (
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
                )}
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
              {combined && (
                <span className="text-[11px] text-[var(--text-dim)]">
                  {t(
                    shown.platform === 'vrchat'
                      ? 'friends.platform.vrchatShort'
                      : 'friends.platform.chilloutvrShort'
                  )}
                </span>
              )}
              {descriptorKey && (
                <span className="ml-auto text-right text-[12px] text-[var(--text-dim)]">
                  {t(descriptorKey)}
                </span>
              )}
            </div>

            {shownAccounts.some((account) => account.presence.state === 'in-game') && (
              <div className="flex flex-col gap-[var(--space-2)]">
                <h3 className="text-[10.5px] font-semibold tracking-widest text-[var(--text-dim)] uppercase">
                  {t('drawer.where')}
                </h3>
                <LinkedWorlds accounts={shownAccounts} variant="drawer" />
              </div>
            )}

            {/* 4 · Actions — phase 1 = the one real action. */}
            {joinable && (
              <div className="flex flex-col gap-[var(--space-1)]">
                <button
                  type="button"
                  onClick={() => {
                    if (combined) setChooserOwner(identityOwner)
                    else if (shown) void join(shown)
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
                  {joinFailure ? t(joinFailureMessageKey(joinFailure)) : ''}
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
                  <label htmlFor="friend-notes">
                    {t(combined ? 'linking.sharedNotes' : 'drawer.notes.heading')}
                  </label>
                </h3>
                <textarea
                  ref={notesTextareaRef}
                  id="friend-notes"
                  value={noteValue}
                  readOnly={!noteWritable}
                  aria-describedby={
                    noteLoadFailed || noteSaveFailed ? 'friend-notes-error' : undefined
                  }
                  onChange={(event) => setNoteValue(event.target.value)}
                  onBlur={onNoteBlur}
                  maxLength={500}
                  rows={4}
                  placeholder={t('drawer.notes.placeholder')}
                  aria-labelledby="friend-notes-label"
                  className="w-full resize-none rounded-control border bg-[var(--control-fill)] px-[var(--space-3)] py-[var(--space-2)] text-[13px] text-[var(--text)] placeholder:text-[var(--text-faint)] read-only:cursor-default read-only:opacity-50 focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)]"
                  style={{ borderColor: 'var(--border)' }}
                />
                {(noteLoadFailed || noteSaveFailed) && (
                  <div
                    id="friend-notes-error"
                    role="alert"
                    className="flex items-start gap-[var(--space-2)] rounded-control border px-[var(--space-2)] py-[var(--space-2)] text-[12px] text-[var(--text-dim)]"
                    style={{
                      borderColor: 'color-mix(in srgb, var(--error) 45%, transparent)',
                      background: 'color-mix(in srgb, var(--error) 10%, transparent)'
                    }}
                  >
                    <span aria-hidden="true" className="font-bold text-[var(--error)]">
                      !
                    </span>
                    <p className="min-w-0 flex-1">
                      {t(noteLoadFailed ? 'drawer.notes.loadFailed' : 'drawer.notes.saveFailed')}
                    </p>
                    <button
                      type="button"
                      onClick={retryNote}
                      className="shrink-0 rounded-pill px-[var(--space-1)] font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)]"
                    >
                      {t('drawer.notes.retry')}
                    </button>
                  </div>
                )}
                <span
                  aria-live="polite"
                  className="text-right text-[11px] text-[var(--text-faint)]"
                >
                  {t('drawer.notes.counter', { current: noteValue.length })}
                </span>
              </div>
            )}
            {trustKey && (
              <p className="text-[12px] text-[var(--text-dim)]">
                {t('drawer.trust', { rank: t(trustKey) })}
              </p>
            )}
            {selection && onNavigate && (
              <div className="mt-auto pt-[var(--space-2)]">
                <button
                  type="button"
                  className="linked-identities rounded-control border border-transparent px-[var(--space-3)] py-[var(--space-2)] text-[12px] font-semibold"
                  onClick={() => {
                    onNoteBlur()
                    setIdentityDialogOwner(identityOwner)
                  }}
                >
                  <span
                    style={{
                      background:
                        'linear-gradient(90deg, var(--plat-vrc-ghost-text), var(--plat-cvr-ghost-text))',
                      backgroundClip: 'text',
                      color: 'transparent'
                    }}
                  >
                    {t('linking.identities')}
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {open && chooserOwner !== null && (
        <LinkedDestinationChooser accounts={shownAccounts} onClose={() => setChooserOwner(null)} />
      )}
      {open && identityDialogOwner !== null && selection && onNavigate && (
        <IdentitiesDialog
          selection={selection}
          friends={friends ?? selection.accounts}
          accountIds={accountIds ?? {}}
          available={available}
          onNavigate={onNavigate}
          onClose={() => setIdentityDialogOwner(null)}
        />
      )}
    </div>
  )
}
