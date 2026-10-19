/**
 * HotInstanceCard (§9, VRX-198; exact-instance + card Join VRX-237).
 *
 * Two layouts share every fact and control (owner, 2026-10-18):
 *  - `bar`: the compact card. Visual-weight order, top to bottom: world name →
 *    instance pill (hero) → who's-here → platform (quiet a11y label). A 2×2
 *    grid: the world name (r1c1) and who's-here (r2c1) share the left 1fr
 *    column; the instance pill (r1c2) and platform pill (r2c2) share a right
 *    column floored at 78px and grown to `max-content`, so the two pills are
 *    always the SAME width and their edges line up. When the world thumbnail
 *    is known it sits behind the bar under a scrim and the platform tint.
 *  - `picture`: the Popular now card shape (ExploreWorldCard) — picture with
 *    the VRC/CVR badge, then world name beside the instance pill, then
 *    who's-here. Used when Hot Instances is the first Dashboard section and on
 *    the Hot Instances page.
 *
 * The whole-card click/Enter/Space opens the hot-instance detail sheet (VRX-250).
 * The hero pill's Join is its OWN explicit control — a card click never joins.
 */
import { useRef, useState } from 'react'
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
  const joinFailure = joinTarget !== null ? joinFailureFor(joinTarget) : null
  const isVrc = instance.platform === 'vrchat'
  const cardRef = useRef<HTMLDivElement>(null)

  // World thumbnail through the shared main-issued image pipeline (the same
  // one the detail sheet's banner uses). A failed image falls back to the plain
  // card rather than a broken picture.
  const imageDataUrl = useAvatar(instance.thumbnailUrl, cardRef)
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
  const tintClass = isVrc ? 'tint-vrc' : 'tint-cvr'
  const topEdgeStyle = {
    background: isVrc
      ? 'linear-gradient(90deg, var(--vrc), transparent)'
      : 'linear-gradient(90deg, var(--cvr), transparent)'
  }

  // Who's-here: first WHO_HERE_MAX_NAMES names, then "+N". The full list feeds the
  // screen-reader label so nobody is hidden from assistive tech (audit W5 pattern).
  const shownNames = instance.friendNames.slice(0, WHO_HERE_MAX_NAMES)
  const overflow = instance.friendCount - shownNames.length
  const whoHereAria = t('dashboard.friendsHereAria', {
    count: instance.friendCount,
    names: instance.friendNames.join(', ')
  })

  function joinCardTarget(event: React.MouseEvent<HTMLButtonElement>): void {
    // Belt-and-suspenders containment for the day the whole-card click (VRX-59)
    // lands: join wins over open, always — same law as the friend row.
    event.stopPropagation()
    if (joinTarget !== null) void join(joinTarget)
  }

  function openSheet(event: React.MouseEvent<HTMLDivElement>): void {
    const target = event.target
    if (!(target instanceof Element)) return
    // Join wins over open: the hero pill is an independent sibling control.
    if (target.closest('[data-join-pill]') !== null) return
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
    if (cardRef.current !== null) onOpen(instance, cardRef.current)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    // Keyboard containment: nested controls (the Join pill, etc.) must fire
    // themselves, not open the sheet. This mirrors the pointer target guard and
    // covers any future nested control (VRX-250 review).
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (cardRef.current !== null) onOpen(instance, cardRef.current)
    }
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
            aria-label={t('friends.joinAria', {
              name: joinTarget.displayName,
              // The STRIPPED display name — same as the visible title, never
              // the raw `(#…)`-suffixed wire name.
              world: worldName
            })}
          />
          <span
            role="status"
            className="pointer-events-none absolute inset-0 flex items-center justify-center truncate px-[var(--space-1)] text-[12px] text-[var(--text-dim)]"
          >
            {joinFailure ? t(joinFailureMessageKey(joinFailure)) : ''}
          </span>
        </span>
      </PictureBackedPill>
    )
  }

  // Who's-here names truncate BEFORE the shrink-proof "+N" so the overflow count
  // never gets clipped on a narrow card. Full list is in the aria-label.
  function whoHere(placement: string): React.JSX.Element {
    return (
      <div
        className={`${placement} flex min-w-0 items-baseline text-[13.5px] leading-[1.2]`}
        aria-label={whoHereAria}
      >
        <span className="min-w-0 truncate text-[var(--names-lift)]">{shownNames.join(', ')}</span>
        {overflow > 0 && (
          <span className="ml-[4px] shrink-0 font-bold text-[var(--text)]">
            {t('dashboard.friendsOverflow', { count: overflow })}
          </span>
        )}
      </div>
    )
  }

  const cardProps = {
    ref: cardRef,
    role: 'button',
    tabIndex: 0,
    'data-hot-sheet-opener': true,
    'data-hot-card-layout': layout,
    'aria-label': t('hotSheet.ariaLabel', { world: worldName }),
    onClick: openSheet,
    onKeyDown
  } as const

  if (layout === 'picture') {
    const platformName = t(isVrc ? 'dashboard.platformVrc' : 'dashboard.platformCvr')
    return (
      <div
        {...cardProps}
        className={`glass glass-information ${tintClass} relative flex h-full w-full min-w-0 cursor-pointer flex-col overflow-hidden hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-[var(--text-dim)] motion-safe:transition-[filter]`}
      >
        <div aria-hidden="true" className="h-[4px] w-full" style={topEdgeStyle} />
        {/* Picture area — same frame, placeholder and badge as ExploreWorldCard. */}
        <div className="relative aspect-[16/7] overflow-hidden bg-[var(--surface-hover)]">
          {image !== null ? (
            <img
              src={image}
              alt=""
              className="h-full w-full object-cover"
              onError={markImageFailed}
            />
          ) : null}
          <span
            className="absolute left-[var(--space-2)] top-[var(--space-2)] rounded-[9px] border px-[var(--space-2)] py-[var(--space-0-5)] text-[10px] font-bold"
            style={{
              color: isVrc ? 'var(--plat-vrc-ghost-text)' : 'var(--plat-cvr-ghost-text)',
              borderColor: isVrc ? 'var(--plat-vrc-ghost-border)' : 'var(--plat-cvr-ghost-border)',
              background: 'color-mix(in srgb, var(--bg-base) 55%, transparent)'
            }}
          >
            <span aria-hidden="true">{isVrc ? 'VRC' : 'CVR'}</span>
            <span className="sr-only">{platformName}</span>
          </span>
        </div>
        <div className="relative flex flex-1 flex-col gap-[var(--space-2)] p-[var(--space-3)]">
          <div className="flex min-w-0 items-center gap-[var(--space-3)]">
            <h3
              className="min-w-0 flex-1 truncate text-[18px] font-bold leading-[1.35] text-[var(--text)]"
              // Tooltip shows the FULL untrimmed name (VRX-199).
              title={instance.worldName ?? worldName}
            >
              {worldName}
            </h3>
            {heroPill('shrink-0', false)}
          </div>
          {whoHere('')}
        </div>
      </div>
    )
  }

  return (
    <div
      {...cardProps}
      className={`glass glass-information ${tintClass} relative cursor-pointer overflow-hidden hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-[var(--text-dim)] motion-safe:transition-[filter]`}
    >
      <CardPictureBackdrop image={image} platform={instance.platform} onError={markImageFailed} />
      {/* 4px top-edge platform stripe */}
      <div aria-hidden="true" className="relative h-[4px]" style={topEdgeStyle} />

      <div
        className="relative p-[14px_16px]"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) minmax(78px, max-content)',
          gridTemplateRows: 'auto 1fr',
          columnGap: '12px',
          rowGap: '16px',
          minHeight: '96px'
        }}
      >
        {/* World name — top-left. 25px with descender room (line-height 1.5) so
            'y'/'g'/'p' tails aren't clipped; relaxes VRX-198's exact-pill-height
            rule. Shares the line with the pill ("lined paper"); truncates with
            ellipsis. */}
        <div
          className="col-start-1 row-start-1 self-center min-w-0 text-[25px] font-bold leading-[1.5] text-[var(--text)] overflow-hidden text-ellipsis whitespace-nowrap"
          // Tooltip shows the FULL untrimmed name (VRX-199) — reveals both a
          // truncated long name AND the stripped `(#…)` suffix on hover.
          title={instance.worldName ?? worldName}
        >
          {worldName}
        </div>

        {heroPill('col-start-2 row-start-1 self-center', image !== null)}

        {whoHere('col-start-1 row-start-2 self-end')}

        {/* Platform pill (quiet a11y label) — bottom-right */}
        <PictureBackedPill backed={image !== null} className="col-start-2 row-start-2 self-end">
          <PlatformPill platform={instance.platform} className="w-full" />
        </PictureBackedPill>
      </div>
    </div>
  )
}
