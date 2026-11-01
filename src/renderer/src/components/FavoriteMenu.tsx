import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { canAddToGroup, type GameFavoriteWriteFailure } from '@shared/gameFavorites'
import type { Platform } from '@shared/types'
import {
  GAME_FAVORITES_HEADING,
  useGameFavorites,
  useSetGameFavorite,
  type GameFavoriteTarget,
  type GameFavoritesState
} from '../queries/gameFavorites'
import { useUiStore } from '../stores/ui'
import { FavoriteStarButton, StarGlyph } from './FavoriteStar'

export interface LocalStar {
  on: boolean
  writable: boolean
  /** Resolves to the i18n key of a failure, or null. */
  toggle: () => Promise<string | null>
}

/**
 * The favorite star and the small panel it opens (owner, 2026-11-01): a star
 * kept only in VRX, and the favorite groups in the user's own VRChat or
 * ChilloutVR account, as VRCX's and CVRX's pickers show them. The star is
 * filled while the item is starred anywhere. Non-modal disclosure like the
 * alerts bell: Esc or a press outside folds it.
 */
export default function FavoriteMenu({
  name,
  local,
  games,
  shape,
  placement,
  open: allowed = true,
  anchored = true,
  onLeave
}: {
  /** The friend's or world's name, for the star's accessible name. */
  name: string
  local: LocalStar
  /** One entry per game account the item belongs to. */
  games: readonly GameFavoriteTarget[]
  shape: 'square' | 'round'
  /** `above` for the drawer footer, `below` for a sheet title. */
  placement: 'above' | 'below'
  /** False folds the panel (its drawer or sheet closed). */
  open?: boolean
  /** False lets the panel line up with a wider positioned parent. */
  anchored?: boolean
  /** Runs before leaving for Settings. */
  onLeave?: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (open && !allowed) setOpen(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const headingId = useId()
  const vrchat = useGameFavorites('vrchat')
  const chilloutvr = useGameFavorites('chilloutvr')
  const states: Record<Platform, GameFavoritesState> = { vrchat, chilloutvr }
  const inGame = games.some((target) => groupsOf(states[target.platform], target).length > 0)
  const on = local.on || inGame

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent): void {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useEffect(() => {
    const panel = panelRef.current
    if (!open || !panel) return
    // A sheet's body scrolls: bring the whole panel into view once it has
    // opened, so the last group is never cut off at the window's edge. With
    // motion on, the panel grows in, so wait until it is at full size.
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    const reveal = (): void =>
      panel.scrollIntoView?.({ block: 'nearest', behavior: still ? 'auto' : 'smooth' })
    if (still) {
      const frame = requestAnimationFrame(reveal)
      return () => cancelAnimationFrame(frame)
    }
    const onEnd = (event: TransitionEvent): void => {
      if (event.target === panel && event.propertyName === 'transform') reveal()
    }
    panel.addEventListener('transitionend', onEnd)
    return () => panel.removeEventListener('transitionend', onEnd)
  }, [open])

  const side =
    placement === 'above'
      ? 'right-0 bottom-[calc(100%+var(--space-2))] origin-bottom-right'
      : 'left-0 top-[calc(100%+var(--space-2))] origin-top-left'

  return (
    <div
      ref={rootRef}
      className={anchored ? 'relative' : 'contents'}
      onKeyDown={(event) => {
        // Esc folds the panel first; the drawer's own Esc waits for the next press.
        if (event.key !== 'Escape' || !open) return
        event.stopPropagation()
        setOpen(false)
        buttonRef.current?.focus()
      }}
    >
      <FavoriteStarButton
        ref={buttonRef}
        shape={shape}
        on={on}
        label={t(on ? 'favorites.menu.labelOn' : 'favorites.menu.labelOff', { name })}
        hint={t('favorites.menu.hint')}
        expanded={open}
        controls={panelId}
        onToggle={() => setOpen(!open)}
        className="shrink-0"
      />
      <div
        ref={panelRef}
        id={panelId}
        data-favorite-menu=""
        data-open={open}
        inert={!open}
        aria-hidden={!open}
        aria-labelledby={headingId}
        role="group"
        className={`favorite-panel alert-bell-panel glass glass-information absolute z-20 flex w-[300px] max-w-[calc(100vw-48px)] flex-col gap-[var(--space-3)] p-[var(--space-3)] ${side}`}
      >
        <div className="alert-bell-step flex items-center gap-[var(--space-2)]" style={step(0)}>
          <span className="favorite-star" data-on={on} aria-hidden="true">
            <StarGlyph on={on} />
          </span>
          <h3
            id={headingId}
            className="text-[10.5px] font-semibold tracking-widest text-[var(--text-dim)] uppercase"
          >
            {t('favorites.menu.heading')}
          </h3>
        </div>
        <LocalSection local={local} />
        {games.map((target, index) => (
          <GameSection
            key={`${target.platform}:${target.kind === 'friend' ? target.friendId : target.world.worldId}`}
            target={target}
            state={states[target.platform]}
            index={index + 2}
            onLeave={onLeave}
          />
        ))}
      </div>
    </div>
  )
}

function groupsOf(state: GameFavoritesState, target: GameFavoriteTarget): readonly string[] {
  const favorites = state.favorites
  if (!favorites) return []
  return target.kind === 'friend'
    ? (favorites.friends[target.friendId] ?? [])
    : (favorites.worlds[target.world.worldId] ?? [])
}

function LocalSection({ local }: { local: LocalStar }): React.JSX.Element {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const toggle = async (): Promise<void> => {
    setFailure(null)
    setSaving(true)
    const key = await local.toggle()
    setSaving(false)
    setFailure(key)
  }
  return (
    <section className="alert-bell-step flex flex-col gap-[var(--space-1)]" style={step(1)}>
      <h4 className="text-[11.5px] font-semibold text-[var(--text-dim)]">
        {t('favorites.menu.vrx')}
      </h4>
      <ChoiceRow
        on={local.on}
        disabled={!local.writable || saving}
        name={t('favorites.menu.vrxStar')}
        note={null}
        onToggle={() => void toggle()}
      />
      {failure && (
        <p role="alert" className="text-[11.5px] text-[var(--text-dim)]">
          {t(failure)}
        </p>
      )}
    </section>
  )
}

const FAILURE_KEYS: Partial<Record<GameFavoriteWriteFailure, string>> = {
  full: 'favorites.menu.groupFull',
  'other-group': 'favorites.menu.oneGroup',
  'rate-limited': 'favorites.menu.slowDown',
  off: 'favorites.menu.off'
}

function GameSection({
  target,
  state,
  index,
  onLeave
}: {
  target: GameFavoriteTarget
  state: GameFavoritesState
  index: number
  onLeave?: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const setGameFavorite = useSetGameFavorite()
  const [saving, setSaving] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  if (state.state === 'hidden' || state.state === 'not-authenticated') return null
  const platformName = t(GAME_FAVORITES_HEADING[target.platform])
  const current = groupsOf(state, target)
  const favorites = state.favorites

  const toggle = async (groupKey: string, add: boolean): Promise<void> => {
    setFailure(null)
    setSaving(groupKey)
    const reason = await setGameFavorite(target, groupKey, add)
    setSaving(null)
    if (reason !== null) setFailure(FAILURE_KEYS[reason] ?? 'favorites.saveFailed')
  }

  const openSettings = (): void => {
    onLeave?.()
    const ui = useUiStore.getState()
    ui.setSettingsCategory('behavior')
    ui.setActiveTab('settings')
  }

  let body: React.ReactNode
  if (state.state === 'loading') {
    body = <Note>{t('favorites.menu.loading', { platform: platformName })}</Note>
  } else if (state.state === 'off') {
    body = (
      <>
        <Note>{t('favorites.menu.offNote')}</Note>
        <button
          type="button"
          onClick={openSettings}
          className="self-start rounded-pill px-[var(--space-1)] text-[12px] font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-dim)]"
        >
          {t('favorites.menu.settings')} <span aria-hidden="true">→</span>
        </button>
      </>
    )
  } else if (!favorites) {
    body = (
      <>
        <Note>{t('favorites.menu.loadFailed', { platform: platformName })}</Note>
        <button
          type="button"
          onClick={() => void state.refresh()}
          className="self-start rounded-pill px-[var(--space-1)] text-[12px] font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-dim)]"
        >
          {t('favorites.menu.retry')}
        </button>
      </>
    )
  } else {
    const groups = favorites.groups[target.kind]
    body =
      groups.length === 0 ? (
        <Note>{t('favorites.menu.noGroups', { platform: platformName })}</Note>
      ) : (
        <>
          <ul className="flex flex-col gap-[2px]">
            {groups.map((group) => {
              const inGroup = current.includes(group.key)
              const addable = canAddToGroup(favorites, current, group)
              return (
                <li key={group.key}>
                  <ChoiceRow
                    on={inGroup}
                    disabled={saving !== null || (!inGroup && !addable)}
                    name={group.name}
                    note={
                      group.capacity === null
                        ? String(group.count)
                        : t('favorites.menu.count', {
                            count: group.count,
                            capacity: group.capacity
                          })
                    }
                    onToggle={() => void toggle(group.key, !inGroup)}
                  />
                </li>
              )
            })}
          </ul>
          {favorites.oneGroupPerItem && current.length > 0 && (
            <Note>{t('favorites.menu.oneGroup')}</Note>
          )}
        </>
      )
  }

  return (
    <section
      className="alert-bell-step flex flex-col gap-[var(--space-1)]"
      style={step(index)}
      data-game-favorites={target.platform}
    >
      <h4 className="text-[11.5px] font-semibold text-[var(--text-dim)]">{platformName}</h4>
      {body}
      {failure && (
        <p role="alert" className="text-[11.5px] text-[var(--text-dim)]">
          {t(failure)}
        </p>
      )}
    </section>
  )
}

function Note({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="text-[12px] leading-snug text-[var(--text-dim)]">{children}</p>
}

/** A group (or the VRX star) as a check row: a ticked box, never color alone. */
function ChoiceRow({
  on,
  disabled,
  name,
  note,
  onToggle
}: {
  on: boolean
  disabled: boolean
  name: string
  note: string | null
  onToggle: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onToggle}
      data-favorite-choice=""
      className="favorite-choice flex w-full items-center gap-[var(--space-2)] rounded-[9px] px-[var(--space-2)] py-[5px] text-left text-[13px] text-[var(--text)] hover:bg-[var(--surface-hover)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-dim)] disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span
        aria-hidden="true"
        className="favorite-choice-box grid h-[16px] w-[16px] flex-none place-items-center rounded-[5px] border text-[11px] font-bold"
      >
        {on ? '✓' : ''}
      </span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {note !== null && (
        <span className="flex-none text-[11.5px] tabular-nums text-[var(--text-dim)]">{note}</span>
      )}
    </button>
  )
}

/** Stagger index for the panel's spring-in, read by `.alert-bell-step`. */
function step(index: number): React.CSSProperties {
  return { '--alert-step': index } as React.CSSProperties
}
