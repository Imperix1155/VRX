import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** How long the button reads "Copied" (or "Couldn't copy") before it resets. */
const RESULT_LABEL_MS = 2_000

type CopyState = 'idle' | 'copied' | 'failed'

/**
 * A quiet "Copy link" button. The word itself changes to say what happened,
 * so the result never depends on color, and a screen reader hears it too.
 * The link is plain text for the clipboard; VRX never opens it.
 */
export default function CopyLinkButton({
  link,
  ariaLabel
}: {
  link: string
  /** Says what the link is to ("Copy link to this world"). */
  ariaLabel: string
}): React.JSX.Element {
  const { t } = useTranslation()
  // The result belongs to the link that was copied: when the same button is
  // reused for another person, world or instance, it reads "Copy link" again.
  const [result, setResult] = useState<{ link: string; state: CopyState } | null>(null)
  const state: CopyState = result !== null && result.link === link ? result.state : 'idle'
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (resetTimer.current !== null) clearTimeout(resetTimer.current)
    }
  }, [])

  function show(copied: string, outcome: Exclude<CopyState, 'idle'>): void {
    if (!mounted.current) return
    setResult({ link: copied, state: outcome })
    resetTimer.current = setTimeout(() => setResult(null), RESULT_LABEL_MS)
  }

  function copy(event: React.MouseEvent<HTMLButtonElement>): void {
    // Inside a sheet or a row: copying is not a press on what holds the button.
    event.stopPropagation()
    if (resetTimer.current !== null) clearTimeout(resetTimer.current)
    const copied = link
    let writing: Promise<void>
    try {
      writing = navigator.clipboard.writeText(copied)
    } catch {
      show(copied, 'failed')
      return
    }
    writing.then(
      () => show(copied, 'copied'),
      () => show(copied, 'failed')
    )
  }

  const word =
    state === 'copied'
      ? t('copyLink.copied')
      : state === 'failed'
        ? t('copyLink.failed')
        : t('copyLink.copy')
  return (
    <>
      <button
        type="button"
        data-copy-link=""
        data-copy-state={state}
        aria-label={state === 'idle' ? ariaLabel : undefined}
        onClick={copy}
        className="shrink-0 whitespace-nowrap rounded-control bg-[var(--control-fill)] px-[var(--space-3)] py-[var(--space-1)] text-xs text-[var(--text-dim)] hover:bg-[var(--control-fill-hover)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-dim)] motion-safe:transition-colors"
      >
        {state === 'copied' ? <span aria-hidden="true">✓ </span> : null}
        {word}
      </button>
      <span role="status" className="sr-only">
        {state === 'idle' ? '' : word}
      </span>
    </>
  )
}
