/**
 * HotInstanceCard (§9, VRX-198; exact-instance + card Join VRX-237).
 *
 * Two layouts share every fact and control (owner, 2026-10-18):
 *  - `bar`: the compact card. Visual-weight order, top to bottom: world name →
 *    instance pill (hero) → who's-here → platform (quiet a11y label). A
 *    two-column grid: the world name (r1c1) and who's-here (r3c1) share the
 *    left 1fr column; the instance pill (r1c2) and platform pill (r3c2) share
 *    a right column floored at 78px and grown to `max-content`, so the two
 *    pills are always the SAME width and their edges line up. Row 2 is the
 *    Join message's full-width line, empty until a Join says something. When
 *    the world thumbnail is known it sits behind the bar under a scrim and the
 *    platform tint.
 *  - `picture`: the Popular now card shape (ExploreWorldCard) — picture with
 *    the VRC/CVR badge, then world name beside the instance pill, then
 *    who's-here. Used when Hot Instances is the first Dashboard section and on
 *    the Hot Instances page.
 *
 * The world name is a real button that opens the hot-instance detail sheet
 * (VRX-250); a click anywhere else on the card takes the same path, as on
 * friend rows. The hero pill's Join is its OWN sibling control — a card click
 * never joins, and no control sits inside another.
 */
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isFriendJoinable } from '@shared/joinability'
import { joinFailureMessageKey, useJoinInstance } from '../hooks/useJoinInstance'
import { useAvatar } from '../hooks/useAvatar'
import { useSettingsStore } from '../stores/settings'
import { instancePillFor } from '../utils/instancePill'
import { stripInstanceSuffix } from '../utils/worldName'
import type { HotInstance } from '../utils/dashboardAggregations'
import InstancePill from './InstancePill'
import PlatformPill from './PlatformPill'
import { CardPictureBackdrop, PictureBackedPill } from './CardPictureBackdrop'

/** How many friend names show on a card before collapsing to "+N" (VRX-198). */
const WHO_HERE_MAX_NAMES = 4

export type HotInstanceCardLayout = 'bar' | 'picture'

export default function HotInstanceCard({
  instance,
  layout = 'bar',
  onOpen
}: {
  instance: HotInstance
  layout?: HotInstanceCardLayout
  onOpen: (instance: HotInstance, opener: HTMLElement) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const labelScheme = useSettingsStore((s) => s.settings.labelScheme)
  // The ONE shared join flow (VRX-237): the card's Join routes through a MEMBER
  // friend — any member works because they provably share the exact instance.
  // `members` is alphabetical, so the first JOINABLE member is a deterministic
  // target. The confirmation dialog (VRX-210) intercepts via the same flow.
  const { isJoining, joinFailureFor, join } = useJoinInstance()
  const joinTarget = instance.members.find(isFriendJoinable) ?? null
  // What the last Join through any member said: the dialog may join through
  // another friend still there (friendForPending), not this first one.
  const joinFailure =
    joinTarget !== null
      ? (instance.members.map(joinFailureFor).find((reason) => reason !== null) ?? null)
      : null
  const isVrc = instance.platform === 'vrchat'
  const cardRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLButtonElement>(null)
  const descriptionId = useId()

  // World thumbnail through the shared main-issued image pipeline (the same
  // one the detail sheet's banner uses). A failed image falls back to the plain
  // card rather than a broken picture.
  const imageDataUrl = useAvatar(instance.thumbnailUrl, cardRef, 'picture')
  const [failedImageKey, setFailedImageKey] = useState<string | null>(null)
  const imageKey = imageDataUrl ? `${instance.thumbnailUrl ?? ''}\u0000${imageDataUrl}` : null
  const image = imageKey !== null && imageKey !== failedImageKey ? imageDataUrl : null
  const markImageFailed = (): void => setFailedImageKey(imageKey)

  const resolvedPill = instancePillFor(
    { type: instance.instanceType, opennessUnknown: instance.opennessUnknown },
    labelScheme
  )
  const opennessLabel = t(resolvedPill.labelKey)
  const tier = resolvedPill.tier
  // Display-only: drop the CVR "(#instanceNumber)" from the face (VRX-198).
  const worldName = instance.worldName
    ? stripInstanceSuffix(instance.worldName)
    : t('friends.instance.unknownWorld')
  const platformName = t(isVrc ? 'dashboard.platformVrc' : 'dashboard.platformCvr')
  const tintClass = isVrc ? 'tint-vrc' : 'tint-cvr'

  // Who's-here: first WHO_HERE_MAX_NAMES names, then "+N". The full list feeds the
  // screen-reader label so nobody is hidden from assistive tech (audit W5 pattern).
  const shownNames = instance.friendNames.slice(0, WHO_HERE_MAX_NAMES)
  const overflow = instance.friendCount - shownNames.length
  const whoHereAria = t('dashboard.friendsHereAria', {
    count: instance.friendCount,
    names: instance.friendNames.join(t('listSeparator'))
  })

  function joinCardTarget(event: React.MouseEvent<HTMLButtonElement>): void {
    // Belt-and-suspenders containment for the day the whole-card click (VRX-59)
    // lands: join wins over open, always — same law as the friend row.
    event.stopPropagation()
    // For the instance, not this member: the dialog keeps it while anyone is there.
    if (joinTarget !== null) void join(joinTarget, { fromHotInstance: true })
  }

  // Whole-card POINTER opener, as on friend rows (VRX-228): the card is no
  // button and no tab stop. The world-name button is the keyboard and
  // screen-reader opener, and focus comes back to it when the sheet closes.
  function openSheet(event: React.MouseEvent<HTMLDivElement>): void {
    const target = event.target
    if (!(target instanceof Element)) return
    // Join wins over open: the hero pill is an independent sibling control.
    // The name button opens on its own, so a key press is never blocked by
    // the selection guard below.
    if (target.closest('[data-join-pill], [data-hot-open]') !== null) return
    // Selection-drag guard (same as the friend row, VRX-228): a stray drag-select
    // across the card text must not open the sheet.
    const selection = window.getSelection()
    if (
      selection !== null &&
      !selection.isCollapsed &&
      selection.rangeCount > 0 &&
      selection.getRangeAt(0).intersectsNode(event.currentTarget)
    )
      return
    if (openerRef.current !== null) onOpen(instance, openerRef.current)
  }

  // The card's opener: a native button (Enter and Space click it) named for
  // the sheet it opens and described by the platform, access and who's here.
  // It sits beside the Join pill, never around it.
  function nameButton(className: string): React.JSX.Element {
    return (
      <button
        ref={openerRef}
        type="button"
        data-hot-open
        onClick={(event) => onOpen(instance, event.currentTarget)}
        aria-label={t('hotSheet.ariaLabel', { world: worldName })}
        aria-describedby={descriptionId}
        // Tooltip shows the FULL untrimmed name (VRX-199) — reveals both a
        // truncated long name AND the stripped `(#…)` suffix on hover.
        title={instance.worldName ?? worldName}
        className={`${className} min-w-0 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap text-left focus:outline-none`}
      >
        {worldName}
      </button>
    )
  }

  // The instance pill (hero). VRX-237: when a member is joinable the pill IS the
  // card's Join affordance — the same row-pill pattern (VRX-166: button variant
  // + shared isFriendJoinable gate + role="status" denial blip), routed through
  // the ONE shared join flow so the VRX-210 confirmation dialog intercepts
  // identically. `placement` carries the consumer's grid/flex position.
  function heroPill(placement: string, backed: boolean): React.JSX.Element {
    if (joinTarget === null) {
      return (
        <PictureBackedPill backed={backed} className={placement}>
          <InstancePill label={opennessLabel} tier={tier} className="w-full min-w-[78px]" />
        </PictureBackedPill>
      )
    }
    return (
      <PictureBackedPill backed={backed} className={placement}>
        <span className="relative block" data-join-pill>
          <InstancePill
            label={opennessLabel}
            tier={tier}
            // The wrapper is stretched to the shared pill column; the pill inside
            // must fill it (w-full + the FriendsList width floor) or short labels
            // render a shrunk, left-aligned pill and the two-pills-same-width
            // invariant breaks (L8).
            className="w-full min-w-[78px]"
            onJoin={joinCardTarget}
            disabled={isJoining}
            // Starts with the pill's own words, so the name holds what it shows.
            aria-label={t('friends.joinPillAria', {
              access: opennessLabel,
              name: joinTarget.displayName,
              // The STRIPPED display name — same as the visible title, never
              // the raw `(#…)`-suffixed wire name.
              world: worldName
            })}
          />
        </span>
      </PictureBackedPill>
    )
  }

  // What the last Join said, on its own full-width line under the world name
  // and pill (as on friend rows). Failures stay until the next attempt, so an
  // overlay would cover Join; inside the pill's box the text would stretch the
  // pill and squeeze the world name. Empty, it takes no room.
  function joinStatus(placement: string): React.JSX.Element | null {
    if (joinTarget === null) return null
    return (
      <span
        role="status"
        className={`${placement} block text-[12px] leading-snug break-words text-[var(--text-dim)] [&:not(:empty)]:mt-[var(--space-1)]`}
      >
        {joinFailure ? t(joinFailureMessageKey(joinFailure)) : ''}
      </span>
    )
  }

  // Who's-here names truncate BEFORE the shrink-proof "+N" so the overflow count
  // never gets clipped on a narrow card. Screen readers read the full list as
  // text instead (a label on a plain box is not read).
  function whoHere(placement: string): React.JSX.Element {
    return (
      <div className={`${placement} flex min-w-0 items-baseline text-[13.5px] leading-[1.2]`}>
        <span className="sr-only">{whoHereAria}</span>
        <span aria-hidden="true" className="min-w-0 truncate text-[var(--names-lift)]">
          {shownNames.join(t('listSeparator'))}
        </span>
        {overflow > 0 && (
          <span aria-hidden="true" className="ml-[4px] shrink-0 font-bold text-[var(--text)]">
            {t('dashboard.friendsOverflow', { count: overflow })}
          </span>
        )}
      </div>
    )
  }

  const cardProps = {
    ref: cardRef,
    'data-hot-sheet-opener': true,
    'data-list-key': instance.groupKey,
    'data-hot-card-layout': layout,
    onClick: openSheet
  } as const
  // The ring shows while the name button has keyboard focus, as the card's
  // own ring did; the Join pill keeps its own ring.
  const focusRing =
    'has-[[data-hot-open]:focus-visible]:ring-2 has-[[data-hot-open]:focus-visible]:ring-[var(--text-dim)]'
  // The name button's description. Hidden, so browse mode still reads each
  // fact once, from the card itself.
  const description = (
    <span id={descriptionId} hidden>
      {[platformName, opennessLabel, whoHereAria].join(t('listSeparator'))}
    </span>
  )

  if (layout === 'picture') {
    return (
      <div
        {...cardProps}
        className={`glass glass-layer ${tintClass} glass-hover relative flex h-full w-full min-w-0 cursor-pointer flex-col ${focusRing}`}
      >
        {description}
        {/* Picture area — same frame, placeholder and badge as ExploreWorldCard. */}
        <div className="glass-clip-top relative aspect-[16/7] overflow-hidden bg-[var(--surface-hover)]">
          {image !== null ? (
            <img
              src={image}
              alt=""
              className="h-full w-full object-cover"
              onError={markImageFailed}
            />
          ) : null}
          <span
            className="glass-chip absolute left-[var(--space-2)] top-[var(--space-2)] rounded-[9px] border px-[var(--space-2)] py-[var(--space-0-5)] text-[10px] font-bold"
            style={{
              color: isVrc ? 'var(--plat-vrc-badge-text)' : 'var(--plat-cvr-badge-text)',
              borderColor: isVrc ? 'var(--plat-vrc-badge-border)' : 'var(--plat-cvr-badge-border)',
              background: isVrc
                ? 'var(--plat-vrc-picture-badge-bg)'
                : 'var(--plat-cvr-picture-badge-bg)'
            }}
          >
            <span aria-hidden="true">
              {t(isVrc ? 'friends.platform.vrchatShort' : 'friends.platform.chilloutvrShort')}
            </span>
            <span className="sr-only">{platformName}</span>
          </span>
        </div>
        <div className="relative flex flex-1 flex-col gap-[var(--space-2)] p-[var(--space-3)]">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-[var(--space-3)]">
              <h3 className="min-w-0 flex-1 text-[18px] font-bold leading-[1.35] text-[var(--text)]">
                {nameButton('block w-full')}
              </h3>
              {heroPill('shrink-0', false)}
            </div>
            {joinStatus('')}
          </div>
          {whoHere('')}
        </div>
      </div>
    )
  }

  return (
    <div
      {...cardProps}
      className={`glass glass-layer ${tintClass} glass-hover relative cursor-pointer ${focusRing}`}
    >
      {description}
      <CardPictureBackdrop image={image} platform={instance.platform} onError={markImageFailed} />

      <div
        className="relative p-[14px_16px]"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) minmax(78px, max-content)',
          // The middle row is the Join message's line: 0px while empty, so the
          // bottom row's 16px top margin keeps the old 16px row gap.
          gridTemplateRows: 'auto auto 1fr',
          columnGap: '12px',
          minHeight: '96px'
        }}
      >
        {/* World name — top-left. 25px with descender room (line-height 1.5) so
            'y'/'g'/'p' tails aren't clipped; relaxes VRX-198's exact-pill-height
            rule. Shares the line with the pill ("lined paper"); truncates with
            ellipsis. */}
        {nameButton(
          'col-start-1 row-start-1 self-center text-[25px] font-bold leading-[1.5] text-[var(--text)]'
        )}

        {heroPill('col-start-2 row-start-1 self-center', image !== null)}

        {joinStatus('col-span-full row-start-2')}

        {whoHere('col-start-1 row-start-3 self-end mt-[16px]')}

        {/* Platform pill (quiet a11y label) — bottom-right */}
        <PictureBackedPill
          backed={image !== null}
          className="col-start-2 row-start-3 self-end mt-[16px]"
        >
          <PlatformPill platform={instance.platform} className="w-full" />
        </PictureBackedPill>
      </div>
    </div>
  )
}
