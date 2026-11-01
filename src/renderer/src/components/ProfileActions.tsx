/**
 * Unfriend, Block and Unblock at the foot of a full profile (owner,
 * 2026-11-01). Simple by default: one quiet "Unfriend or block" button. Its
 * press reads whether the person is blocked (one request), then shows only the
 * actions that apply. Every action opens a true modal that names the person
 * and the platform, focuses Cancel, and sends one change for one person. Both
 * platforms show the same layout, words and order.
 *
 * The modal is portaled to the body so a drawer's or sheet's transform cannot
 * trap it, and it stops its own pointer and key events so the drawer or sheet
 * behind it does not close while it is open.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { SocialAction, SocialActionResult } from '@shared/socialActions'
import type { Platform } from '@shared/types'
import { useRelationship, useSocialAction } from '../queries/community'
import PlatformPill from './PlatformPill'

type ActionFailure = Extract<SocialActionResult, { ok: false }>['reason'] | 'unknown'

/** Quoted literals keep the locale parity scan aware of these keys. */
const ACTION_KEYS: Record<SocialAction, string> = {
  unfriend: 'profile.actions.unfriend',
  block: 'profile.actions.block',
  unblock: 'profile.actions.unblock'
}
const DONE_KEYS: Record<SocialAction, string> = {
  unfriend: 'profile.actions.done.unfriend',
  block: 'profile.actions.done.block',
  unblock: 'profile.actions.done.unblock'
}
const TITLE_KEYS: Record<SocialAction, string> = {
  unfriend: 'profile.actions.confirm.title.unfriend',
  block: 'profile.actions.confirm.title.block',
  unblock: 'profile.actions.confirm.title.unblock'
}
const BODY_KEYS: Record<SocialAction, string> = {
  unfriend: 'profile.actions.confirm.body.unfriend',
  block: 'profile.actions.confirm.body.block',
  unblock: 'profile.actions.confirm.body.unblock'
}
const ERROR_KEYS: Record<ActionFailure, string> = {
  'not-authenticated': 'profile.actions.error.not-authenticated',
  'rate-limited': 'profile.actions.error.rate-limited',
  unavailable: 'profile.actions.error.unavailable',
  'unknown-person': 'profile.actions.error.unknown-person',
  'not-friend': 'profile.actions.error.not-friend',
  busy: 'profile.actions.error.busy',
  'not-connected': 'profile.actions.error.not-connected',
  unknown: 'profile.actions.error.unknown'
}
const PLATFORM_KEYS: Record<Platform, string> = {
  vrchat: 'dashboard.platformVrc',
  chilloutvr: 'dashboard.platformCvr'
}

const QUIET_BUTTON =
  'rounded-control px-[var(--space-3)] py-[var(--space-2)] text-[12px] font-semibold text-[var(--text)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors disabled:pointer-events-none disabled:opacity-50'
/** Unfriend and Block change something the user may not get back alone. */
const DESTRUCTIVE_STYLE: React.CSSProperties = {
  borderColor: 'color-mix(in srgb, var(--error) var(--pill-edge-strong), transparent)',
  background: 'color-mix(in srgb, var(--error) var(--pill-tint), transparent)',
  color: 'var(--error)'
}

export default function ProfileActions({
  platform,
  userId,
  name
}: {
  platform: Platform
  userId: string
  name: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState<SocialAction | null>(null)
  const [done, setDone] = useState<SocialAction | null>(null)
  const panelId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const relationship = useRelationship(platform, userId, open)
  const platformName = t(PLATFORM_KEYS[platform])
  const result = relationship.data

  let body: React.JSX.Element | null = null
  if (open) {
    if (result === undefined && !relationship.isError) {
      body = (
        <p role="status" className="text-[13px] text-[var(--text-dim)]">
          {t('profile.actions.checking')}
        </p>
      )
    } else if (result === undefined || !result.ok) {
      body = (
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <p role="alert" className="text-[13px] text-[var(--text-dim)]">
            {result?.ok === false && result.reason !== 'unavailable'
              ? t(ERROR_KEYS[result.reason], { platform: platformName })
              : t('profile.actions.checkError')}
          </p>
          <button
            type="button"
            onClick={() => void relationship.refetch()}
            className="rounded-control px-[var(--space-2)] py-[var(--space-1)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-hover)] motion-safe:transition-colors"
          >
            {t('community.retry')}
          </button>
        </div>
      )
    } else {
      const { isFriend, blocked } = result.relationship
      const actions: SocialAction[] = [
        ...(isFriend ? (['unfriend'] as const) : []),
        ...(blocked !== true ? (['block'] as const) : []),
        ...(blocked !== false ? (['unblock'] as const) : [])
      ]
      body = (
        <>
          <div className="flex flex-wrap gap-[var(--space-2)]">
            {actions.map((action) => (
              <button
                key={action}
                type="button"
                data-social-action={action}
                onClick={() => {
                  setDone(null)
                  setConfirming(action)
                }}
                className={`${QUIET_BUTTON} border`}
                style={action === 'unblock' ? { borderColor: 'var(--border)' } : DESTRUCTIVE_STYLE}
              >
                {t(ACTION_KEYS[action])}
              </button>
            ))}
          </div>
          {blocked === null ? (
            <p className="text-xs text-[var(--text-dim)]">{t('profile.actions.unknownBlock')}</p>
          ) : null}
        </>
      )
    }
  }

  return (
    <div className="flex flex-col gap-[var(--space-2)] border-t border-[var(--border)] pt-[var(--space-3)]">
      <div>
        <button
          type="button"
          ref={toggleRef}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className={QUIET_BUTTON}
        >
          {t(open ? 'profile.actions.hide' : 'profile.actions.show')}
        </button>
      </div>
      <div id={panelId} hidden={!open} className="flex flex-col gap-[var(--space-2)]">
        {open ? (
          <>
            <p className="text-xs text-[var(--text-dim)]">
              {t('profile.actions.hint', { platform: platformName })}
            </p>
            {done !== null ? (
              <p role="status" className="text-[13px] text-[var(--text)]">
                <span aria-hidden="true">✓ </span>
                {t(DONE_KEYS[done], { platform: platformName })}
              </p>
            ) : null}
            {body}
          </>
        ) : null}
      </div>
      {confirming !== null ? (
        <SocialConfirmDialog
          platform={platform}
          userId={userId}
          name={name}
          action={confirming}
          fallbackFocus={toggleRef}
          onClose={() => setConfirming(null)}
          onDone={(action) => {
            setConfirming(null)
            setDone(action)
          }}
        />
      ) : null}
    </div>
  )
}

function SocialConfirmDialog({
  platform,
  userId,
  name,
  action,
  fallbackFocus,
  onClose,
  onDone
}: {
  platform: Platform
  userId: string
  name: string
  action: SocialAction
  fallbackFocus: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
  onDone: (action: SocialAction) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const send = useSocialAction()
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<ActionFailure | null>(null)
  const pendingRef = useRef(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const bodyId = useId()
  const platformName = t(PLATFORM_KEYS[platform])
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  }, [onClose])

  // Focus starts on Cancel and goes back to the button that opened the
  // dialog, or to the toggle when that button changed (Block became Unblock).
  useEffect(() => {
    const opener = document.activeElement
    // The toggle stays mounted for the dialog's whole life.
    const fallback = fallbackFocus.current
    cancelRef.current?.focus()
    return () => {
      const target = opener instanceof HTMLElement && opener.isConnected ? opener : fallback
      target?.focus({ preventScroll: true })
    }
  }, [fallbackFocus])

  // An account change closes the dialog: the review was for the old account.
  useEffect(() => {
    const boundary = window.vrx?.onIdentityBoundary?.((event) => {
      if (event.platform === platform) close.current()
    })
    const friend = window.vrx?.onFriendEvent?.((event) => {
      if (event.type === 'auth-invalidated' && event.platform === platform) close.current()
    })
    return () => {
      boundary?.()
      friend?.()
    }
  }, [platform])

  const confirm = async (): Promise<void> => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setFailure(null)
    try {
      const result = await send(platform, userId, action)
      if (result.ok) {
        onDone(action)
        return
      }
      setFailure(result.reason)
    } catch {
      setFailure('unknown')
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    // The drawer or sheet behind listens on the document; this dialog owns
    // every key while it is open.
    event.stopPropagation()
    if (event.key === 'Escape') {
      if (!pendingRef.current) onClose()
      return
    }
    if (event.key !== 'Tab') return
    const panel = panelRef.current
    if (panel === null) return
    const focusables = Array.from(panel.querySelectorAll<HTMLElement>('button')).filter(
      (element) => !element.hasAttribute('disabled')
    )
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (first === undefined || last === undefined) {
      panel.focus({ preventScroll: true })
      event.preventDefault()
    } else if (event.shiftKey && document.activeElement === first) {
      last.focus()
      event.preventDefault()
    } else if (!event.shiftKey && document.activeElement === last) {
      first.focus()
      event.preventDefault()
    } else if (!panel.contains(document.activeElement)) {
      first.focus()
      event.preventDefault()
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-[var(--space-6)]"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      <div
        data-testid="social-confirm-scrim"
        aria-hidden="true"
        onPointerDown={() => {
          if (!pendingRef.current) onClose()
        }}
        className="absolute inset-0 bg-[var(--scrim)]"
      />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        data-social-confirm={action}
        className="glass glass-frosted-heavy glass-information relative flex w-[400px] max-w-full flex-col gap-[var(--space-3)] overflow-hidden p-[var(--space-6)] focus:outline-none"
      >
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[4px]"
          style={{
            background:
              platform === 'vrchat'
                ? 'linear-gradient(90deg, var(--vrc), transparent)'
                : 'linear-gradient(90deg, var(--cvr), transparent)'
          }}
        />
        <div className="flex items-start justify-between gap-[var(--space-3)]">
          <h2
            id={titleId}
            className="min-w-0 break-words text-base font-semibold text-[var(--text)]"
          >
            {t(TITLE_KEYS[action], { name })}
          </h2>
          <PlatformPill platform={platform} className="shrink-0" />
        </div>
        <p id={bodyId} className="text-sm text-[var(--text-dim)]">
          {t(BODY_KEYS[action], { platform: platformName })}
        </p>
        {failure !== null ? (
          <p role="alert" className="text-[13px] text-[var(--error)]">
            {t(ERROR_KEYS[failure], { platform: platformName })}
          </p>
        ) : null}
        <div className="mt-[var(--space-1)] flex flex-wrap items-center justify-end gap-[var(--space-2)]">
          <button
            ref={cancelRef}
            type="button"
            disabled={pending}
            onClick={onClose}
            className="rounded-control border border-[var(--border)] bg-[var(--control-fill)] px-[var(--space-4)] py-[var(--space-2)] text-sm font-medium text-[var(--text)] hover:bg-[var(--control-fill-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors disabled:pointer-events-none disabled:opacity-50"
          >
            {t('profile.actions.confirm.cancel')}
          </button>
          <button
            type="button"
            disabled={pending}
            data-social-confirm-submit=""
            onClick={() => void confirm()}
            className="rounded-control border px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold hover:brightness-110 active:brightness-95 focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-[filter] disabled:pointer-events-none disabled:opacity-50"
            style={
              action === 'unblock'
                ? {
                    borderColor: 'var(--border)',
                    background: 'var(--control-fill)',
                    color: 'var(--text)'
                  }
                : DESTRUCTIVE_STYLE
            }
          >
            {pending ? t('profile.actions.confirm.sending') : t(ACTION_KEYS[action])}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
