/**
 * HotInstanceSheet — the bottom sheet for a hot instance (VRX-250).
 *
 * Owner-ratified "Banner" design, 2026-08-08; layout polish round 2026-08-12.
 *
 * A non-modal bottom-anchored sheet that slides up over the dashboard. The sheet
 * and its scrim are contained to the main content area so the sidebar stays fully
 * visible. Clicking anywhere on a hot-instance card opens it; the card's Join pill
 * still wins over open. The sheet shows a world-image banner, every friend in the
 * instance, the instance id, and a policy-space pill.
 *
 * A11y mirrors FriendDrawer's ratified non-modal contract (VRX-225/228):
 * - role="dialog" without aria-modal (the dashboard stays interactive).
 * - NO focus trap; Tab moves freely between the sheet and the page.
 * - Initial focus lands on the ✕ button.
 * - Close paths: Esc, ✕, pointerdown outside (not on a [data-hot-sheet-opener]).
 * - Focus returns to the opener card on close.
 */
import { useEffect, useRef, useState } from 'react'
import { useAvatar } from '../hooks/useAvatar'
import { useTranslation } from 'react-i18next'
import { isFriendJoinable } from '@shared/joinability'
import type { HotInstance } from '../utils/dashboardAggregations'
import { useSettingsStore } from '../stores/settings'
import { joinFailureMessageKey, useJoinInstance } from '../hooks/useJoinInstance'
import { instancePillFor } from '../utils/instancePill'
import { Avatar } from './Avatar'
import InstancePill from './InstancePill'
import PlatformPill from './PlatformPill'
import PolicySpacePill from './PolicySpacePill'

interface HotInstanceSheetProps {
  instance: HotInstance | null
  onClose: () => void
}

export default function HotInstanceSheet({
  instance,
  onClose
}: HotInstanceSheetProps): React.JSX.Element {
  const { t } = useTranslation()
  const labelScheme = useSettingsStore((s) => s.settings.labelScheme)
  const open = instance !== null
  // Retain the last instance so the panel doesn't empty mid slide-out.
  const [retained, setRetained] = useState<HotInstance | null>(null)
  if (instance !== null && instance !== retained) setRetained(instance)
  const shown = instance ?? retained

  const panelRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const bannerRef = useRef<HTMLDivElement>(null)
  const groupCardRef = useRef<HTMLDivElement>(null)

  const { isJoining, joinFailureFor, join, pendingConfirm } = useJoinInstance()
  const joinTarget = shown?.members.find(isFriendJoinable) ?? null
  const joinFailure = joinTarget !== null && shown !== null ? joinFailureFor(joinTarget) : null
  const bannerDataUrl = useAvatar(shown?.thumbnailUrl ?? null, bannerRef)
  const [failedBannerKey, setFailedBannerKey] = useState<string | null>(null)
  const bannerImageKey = bannerDataUrl ? `${shown?.thumbnailUrl ?? ''}\u0000${bannerDataUrl}` : null
  const showBannerImage = bannerImageKey !== null && bannerImageKey !== failedBannerKey

  const groupDataUrl = useAvatar(shown?.groupImageUrl ?? null, groupCardRef)
  const [failedGroupKey, setFailedGroupKey] = useState<string | null>(null)
  const groupImageKey = groupDataUrl ? `${shown?.groupImageUrl ?? ''}\u0000${groupDataUrl}` : null
  const showGroupImage = groupImageKey !== null && groupImageKey !== failedGroupKey
  // The groupId/groupName null-discriminator IS the truthfulness gate;
  // CVR data is live-verified real (VRX-263).
  const showGroupCard =
    shown !== null && shown.isGroup && shown.groupId !== null && shown.groupName !== null

  // Initial focus lands on the ✕ button — keyed on `open` ONLY, so the join
  // confirmation dialog (a modal sibling) does not steal focus back here.
  useEffect(() => {
    if (!open) return
    closeButtonRef.current?.focus()
  }, [open])

  // Esc closes while open. NO focus trap (non-modal contract).
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent): void {
      // While the modal join dialog is parked, Esc belongs to it.
      if (pendingConfirm !== null) return
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose, pendingConfirm])

  // Outside pointerdown closes — except on a [data-hot-sheet-opener] card, which
  // switches the sheet in place. pointerdown (not click) so a drag that starts
  // outside doesn't close on release.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent): void {
      // While the modal join dialog is open, keep the sheet behind it stable.
      if (pendingConfirm !== null) return
      const target = event.target
      if (!(target instanceof Element)) return
      if (panelRef.current?.contains(target)) return
      if (target.closest('[data-hot-sheet-opener]')) return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, onClose, pendingConfirm])

  if (shown === null) {
    return <div inert aria-hidden />
  }

  const isVrc = shown.platform === 'vrchat'
  const worldName = shown.worldName ?? t('friends.instance.unknownWorld')
  const resolvedPill = instancePillFor(
    { type: shown.instanceType, opennessUnknown: shown.opennessUnknown },
    labelScheme
  )
  const typeLabel = t(resolvedPill.labelKey)
  const tier = resolvedPill.tier
  const policySpace = shown.policySpace

  function joinSheetTarget(event: React.MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation()
    if (joinTarget !== null) void join(joinTarget)
  }

  return (
    <div inert={!open} aria-hidden={!open}>
      {/* Soft scrim — pure depth, never an input surface (non-modal).
          Contained to the main content area so the sidebar keeps its full color. */}
      <div
        data-testid="hot-sheet-scrim"
        aria-hidden="true"
        className={`pointer-events-none fixed inset-y-0 left-[var(--content-inset-left)] right-[var(--content-inset-right)] z-40 bg-[var(--scrim-soft)] motion-safe:transition-opacity motion-safe:duration-[220ms] ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-label={worldName}
        className={`fixed bottom-0 left-[var(--content-inset-left)] right-[var(--content-inset-right)] z-50 flex max-h-[34vh] min-h-[360px] flex-col motion-safe:transition-transform motion-safe:duration-[220ms] motion-safe:ease-[cubic-bezier(0.32,0.72,0.29,1)] ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{
          backgroundColor: 'var(--glass-frost)',
          backgroundImage: 'var(--glass-bg)',
          backdropFilter: 'var(--glass-blur-frosted)',
          WebkitBackdropFilter: 'var(--glass-blur-frosted)',
          borderTopLeftRadius: 'var(--radius-panel)',
          borderTopRightRadius: 'var(--radius-panel)',
          borderTop: '1px solid var(--glass-border)',
          boxShadow: 'var(--hot-sheet-shadow)'
        }}
      >
        {/* ✕ close — FIRST child of the panel (Tab from initial focus reaches Join
            next, review 2026-08-12) and a sibling of the clip wrapper so the
            rounded-corner clipping can never swallow it. */}
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label={t('drawer.close')}
          className="absolute top-[var(--space-3)] right-[var(--space-3)] z-10 grid h-[28px] w-[28px] place-items-center rounded-[9px] text-base leading-none text-[var(--text-dim)] hover:bg-[var(--surface-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors"
        >
          <span aria-hidden="true">✕</span>
        </button>

        {/*
          Inner wrapper: matches the panel's top radius and clips the platform
          stripe so it follows the rounded corners instead of spanning the full
          width above them. The close button is a sibling so it cannot be clipped.
        */}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-[var(--radius-panel)]">
          {/* 4px platform-gradient top stripe */}
          <div
            aria-hidden="true"
            data-testid="hot-sheet-stripe"
            className="h-[4px] w-full shrink-0"
            style={{
              background: isVrc
                ? 'linear-gradient(90deg, var(--vrc), transparent)'
                : 'linear-gradient(90deg, var(--cvr), transparent)'
            }}
          />

          {/* Grab bar */}
          <div className="flex justify-center pt-[var(--space-3)] pb-[var(--space-2)]">
            <div
              aria-hidden="true"
              className="h-[4px] w-[44px] rounded-full"
              style={{ background: 'var(--border)' }}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-[var(--space-4)] overflow-y-auto px-[var(--space-2)] py-[var(--space-4)]">
            {/* Banner */}
            <div
              ref={bannerRef}
              data-testid="hot-sheet-banner"
              className="relative h-[150px] w-full shrink-0 overflow-hidden rounded-control"
              style={{
                background: showBannerImage
                  ? undefined
                  : 'linear-gradient(135deg, color-mix(in srgb, var(--text) 10%, transparent), color-mix(in srgb, var(--text) 4%, transparent))'
              }}
            >
              {showBannerImage && (
                <img
                  src={bannerDataUrl ?? undefined}
                  alt=""
                  aria-hidden="true"
                  className="h-full w-full object-cover"
                  style={{ filter: 'brightness(0.66)' }}
                  onError={() => setFailedBannerKey(bannerImageKey)}
                />
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-[var(--space-3)] p-[var(--space-3)]">
                <div className="min-w-0">
                  <h2
                    className="truncate text-[21px] font-bold"
                    style={{
                      color: 'var(--text)',
                      textShadow: 'var(--hot-sheet-banner-title-shadow)'
                    }}
                  >
                    {worldName}
                  </h2>
                  <div
                    className="mt-[var(--space-1)] flex flex-wrap items-center gap-[var(--space-2)]"
                    style={{ textShadow: 'var(--hot-sheet-banner-subtitle-shadow)' }}
                  >
                    <InstancePill label={typeLabel} tier={tier} />
                    <PlatformPill platform={shown.platform} />
                  </div>
                </div>

                {joinTarget !== null && (
                  <span className="relative block shrink-0" data-join-pill>
                    <button
                      type="button"
                      onClick={joinSheetTarget}
                      disabled={isJoining}
                      aria-label={t('friends.joinAria', {
                        name: joinTarget.displayName,
                        world: worldName
                      })}
                      className="rounded-control border px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold hover:brightness-110 active:brightness-95 focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] disabled:cursor-default disabled:opacity-50 motion-safe:transition-[filter]"
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
                      className="pointer-events-none absolute inset-0 flex items-center justify-center truncate px-[var(--space-1)] text-center text-[12px] text-[var(--text-dim)]"
                    >
                      {joinFailure ? t(joinFailureMessageKey(joinFailure)) : ''}
                    </span>
                  </span>
                )}
              </div>
            </div>

            {/* Below banner: friends (left) + meta (right) */}
            <div className="flex min-h-0 flex-1 flex-col gap-[var(--space-4)] sm:flex-row sm:justify-between">
              {/* Friends here */}
              <div className="min-w-0 flex-1">
                <div className="mb-[var(--space-1)]" data-testid="hot-sheet-policy-space">
                  <PolicySpacePill space={policySpace} />
                </div>
                <h3
                  className="mb-[var(--space-2)] text-[10.5px] font-semibold uppercase tracking-[1.4px] text-[var(--text-faint)]"
                  style={{ letterSpacing: '1.4px' }}
                >
                  {t('hotSheet.friendsHereHeading', { count: shown.friendCount })}
                </h3>
                <div className="flex flex-wrap gap-[var(--space-2)]">
                  {shown.members.map((friend) => (
                    <div
                      key={`${friend.platform}:${friend.platformUserId}`}
                      className="inline-flex items-center gap-[var(--space-1)] rounded-[999px] border px-[12px] py-[5px] pl-[6px]"
                      style={{
                        borderColor: 'var(--border)',
                        background: 'var(--control-fill)'
                      }}
                    >
                      <Avatar friend={friend} variant="small" ariaLabel={friend.displayName} />
                      <span className="truncate text-[12.5px] text-[var(--text)]">
                        {friend.displayName}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Meta stack */}
              <div className="flex shrink-0 flex-col items-end justify-end gap-[var(--space-2)] text-right">
                {showGroupCard && (
                  <div
                    ref={groupCardRef}
                    data-testid="hot-sheet-group-card"
                    role="img"
                    aria-label={t('hotSheet.hostedBy', { group: shown.groupName })}
                    className="relative h-[80px] w-[200px] overflow-hidden rounded-control"
                    style={{
                      background: showGroupImage
                        ? undefined
                        : 'linear-gradient(135deg, color-mix(in srgb, var(--text) 14%, transparent), color-mix(in srgb, var(--text) 5%, transparent))'
                    }}
                  >
                    {showGroupImage && (
                      <img
                        src={groupDataUrl ?? undefined}
                        alt=""
                        aria-hidden="true"
                        className="h-full w-full object-cover"
                        style={{ filter: 'brightness(0.6)' }}
                        onError={() => setFailedGroupKey(groupImageKey)}
                      />
                    )}
                    <div className="absolute inset-x-0 bottom-0 p-[var(--space-2)]">
                      <span
                        className="block truncate text-[12.5px] font-semibold"
                        title={shown.groupName ?? undefined}
                        style={{
                          color: 'var(--text)',
                          textShadow: 'var(--hot-sheet-banner-title-shadow)'
                        }}
                      >
                        {shown.groupName}
                      </span>
                    </div>
                  </div>
                )}
                <code
                  className="block max-w-[260px] truncate text-[10.5px] text-[var(--text-faint)]"
                  style={{ fontFamily: 'ui-monospace, monospace' }}
                  title={shown.instanceId}
                  data-testid="hot-sheet-instance-id"
                >
                  {shown.instanceId}
                </code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
