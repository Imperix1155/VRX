import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

const FINE_PRINT = 'text-[11.5px] leading-[1.45] text-[var(--text-dim)]'

/**
 * Simple by default, more on demand (owner, 2026-10-22): one short line of
 * fine print that swaps to the full text in place, so opening it adds only a
 * line or two.
 */
export default function FinePrint({
  summary,
  full,
  centered = false
}: {
  summary: string
  full: string
  centered?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const textId = useId()
  return (
    <p
      id={textId}
      aria-live="polite"
      className={`${FINE_PRINT}${centered ? ' max-w-[52ch] text-center text-balance' : ''}`}
    >
      {open ? full : summary}{' '}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={textId}
        onClick={() => setOpen((value) => !value)}
        className="whitespace-nowrap text-[var(--text-dim)] underline decoration-dotted underline-offset-2 hover:text-[var(--text)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-dim)] motion-safe:transition-colors"
      >
        {t(open ? 'setup.showLess' : 'setup.showMore')}
      </button>
    </p>
  )
}
