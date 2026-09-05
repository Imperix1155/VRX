import { useEffect, useLayoutEffect, useId, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/** Native modality owns keyboard trapping and background inertness. */
export default function LinkedDialog({
  title,
  children,
  busy = false,
  onClose
}: {
  title: string
  children: ReactNode
  busy?: boolean
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
    panel?.showModal()
    closeButton.current?.focus()
    return () => {
      unsubscribe?.()
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
  return (
    <dialog
      ref={dialog}
      data-linked-dialog
      aria-labelledby={headingId}
      aria-modal="true"
      aria-busy={busy}
      className="fixed m-auto max-h-[calc(100vh-var(--space-6)*2)] w-[min(440px,calc(100vw-var(--space-8)))] overflow-y-auto border-0 bg-transparent p-0 text-[var(--text)] [&::backdrop]:bg-[var(--scrim-soft)]"
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        event.stopPropagation()
        if (!busy && event.target === event.currentTarget) onClose()
      }}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
    >
      <div className="glass glass-frosted p-[calc(var(--space-4)+var(--space-1))]">
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
            className="rounded-control px-[var(--space-2)] text-[var(--text-dim)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
