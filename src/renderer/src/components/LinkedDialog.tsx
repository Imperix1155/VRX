import { useEffect, useLayoutEffect, useId, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/** Native modality owns keyboard trapping and background inertness. */
export default function LinkedDialog({
  title,
  children,
  busy = false,
  dismissible = true,
  onClose
}: {
  title: string
  children: ReactNode
  busy?: boolean
  /** False keeps a stray press outside and Escape from closing it, as while
   *  typed changes would be lost; ✕ and the dialog's own Cancel still close it. */
  dismissible?: boolean
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const headingId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const closeRequest = useRef(onClose)
  useLayoutEffect(() => {
    closeRequest.current = onClose
  })
  useEffect(() => {
    const opener = document.activeElement
    const personKey =
      opener instanceof Element
        ? opener.closest('[data-person-key]')?.getAttribute('data-person-key')
        : null
    const drawer = opener instanceof Element ? opener.closest('[data-friend-drawer]') : null
    let boundary = false
    const unsubscribe = window.vrx?.onIdentityBoundary?.(() => {
      boundary = true
      closeRequest.current()
    })
    const panel = dialog.current
    // While a dialog holds Escape back, `closedby="none"` keeps the browser
    // from closing it after a few Escapes in a row. Should the browser close
    // it anyway, follow, so the app never keeps a hidden dialog open. A late
    // close event from an earlier close finds the dialog open again and
    // changes nothing.
    const followClose = (): void => {
      if (panel?.open === false) closeRequest.current()
    }
    panel?.addEventListener('close', followClose)
    panel?.showModal()
    closeButton.current?.focus()
    return () => {
      unsubscribe?.()
      panel?.removeEventListener('close', followClose)
      panel?.close()
      const search = document.querySelector<HTMLInputElement>('#friends-search')
      if (boundary) {
        search?.focus({ preventScroll: true })
        return
      }
      if (opener instanceof HTMLElement && opener.isConnected && !opener.closest('[inert]')) {
        opener.focus({ preventScroll: true })
        return
      }
      const replacement =
        personKey == null
          ? null
          : [...document.querySelectorAll<HTMLElement>('[data-person-key]')]
              .find((row) => row.dataset.personKey === personKey)
              ?.querySelector<HTMLElement>('[data-drawer-opener]')
      if (replacement?.isConnected) replacement.focus({ preventScroll: true })
      else if (drawer?.isConnected && !drawer.closest('[inert]'))
        drawer.querySelector<HTMLElement>('[data-drawer-close]')?.focus({ preventScroll: true })
      else search?.focus({ preventScroll: true })
    }
  }, [])
  // A save disables every control, which drops focus out of the dialog. When
  // it settles, focus goes back to the control last used, or to Close.
  const lastFocused = useRef<HTMLElement | null>(null)
  const wasBusy = useRef(false)
  useEffect(() => {
    if (busy) {
      wasBusy.current = true
      return
    }
    if (!wasBusy.current) return
    wasBusy.current = false
    const panel = dialog.current
    const active = document.activeElement
    if (panel === null || (active !== null && panel.contains(active))) return
    const previous = lastFocused.current
    const target =
      previous?.isConnected && panel.contains(previous) && !previous.matches(':disabled')
        ? previous
        : closeButton.current
    target?.focus({ preventScroll: true })
  }, [busy])
  const holdsBack = busy || !dismissible
  return (
    <dialog
      ref={dialog}
      data-linked-dialog
      aria-labelledby={headingId}
      aria-modal="true"
      aria-busy={busy}
      closedby={holdsBack ? 'none' : 'closerequest'}
      className="fixed m-auto max-h-[calc(100vh-var(--space-6)*2)] w-[min(440px,calc(100vw-var(--space-8)))] overflow-y-auto border-0 bg-transparent p-0 text-[var(--text)] [&::backdrop]:bg-[var(--scrim-soft)]"
      onKeyDown={(event) => event.stopPropagation()}
      onFocus={(event) => {
        if (event.target instanceof HTMLElement) lastFocused.current = event.target
      }}
      onPointerDown={(event) => {
        event.stopPropagation()
        if (event.target !== event.currentTarget) return
        // A press held back leaves focus where it was, so typing goes on there.
        if (holdsBack) event.preventDefault()
        else onClose()
      }}
      onCancel={(event) => {
        event.preventDefault()
        if (!holdsBack) onClose()
      }}
    >
      <div className="glass glass-frosted glass-information p-[calc(var(--space-4)+var(--space-1))]">
        <div className="mb-[var(--space-2)] flex items-start justify-between gap-[var(--space-3)]">
          <h2 id={headingId} className="text-[18px] font-bold">
            {title}
          </h2>
          <button
            ref={closeButton}
            type="button"
            disabled={busy}
            aria-label={t('drawer.close')}
            onClick={onClose}
            className="grid h-[28px] w-[28px] shrink-0 place-items-center rounded-[9px] text-base leading-none text-[var(--text-dim)] hover:bg-[var(--surface-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] disabled:opacity-50 motion-safe:transition-colors"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
