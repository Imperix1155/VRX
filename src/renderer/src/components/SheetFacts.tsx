import type { CopyLink } from '../utils/copyLinks'
import CopyLinkButton from './CopyLinkButton'

/**
 * The extra details a bottom sheet shows once its grab bar is expanded: a
 * small heading over label and value pairs. Values wrap instead of
 * truncating, because seeing all of them is the point of expanding. IDs use
 * the monospace face and can be selected and copied. An ID with a `copyLink`
 * also gets a quiet "Copy link" button beside it.
 */
export interface SheetFact {
  label: string
  value: string
  /** IDs and codes: monospace, break anywhere. */
  mono?: boolean
  /** A link to what this ID names, for the clipboard. */
  copyLink?: CopyLink
}

export function SheetFacts({
  heading,
  facts,
  children
}: {
  heading: string
  facts: SheetFact[]
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <section
      aria-label={heading}
      data-sheet-more=""
      className="sheet-more shrink-0 border-t border-[var(--border)] pt-[var(--space-4)]"
    >
      <h3 className="mb-[var(--space-2)] text-[10.5px] font-semibold uppercase tracking-[1.4px] text-[var(--text-dim)]">
        {heading}
      </h3>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-[var(--space-4)] gap-y-[var(--space-1)] text-[13px]">
        {facts.map((fact) => (
          <div key={fact.label} className="contents">
            <dt className="text-[var(--text-dim)]">{fact.label}</dt>
            <dd
              className={`min-w-0 select-text ${
                fact.mono
                  ? 'break-all text-[12px] text-[var(--text-dim)]'
                  : 'break-words text-[var(--text)]'
              }`}
              style={fact.mono ? { fontFamily: 'ui-monospace, monospace' } : undefined}
            >
              {fact.copyLink === undefined ? (
                fact.value
              ) : (
                <span className="flex flex-wrap items-center gap-x-[var(--space-3)] gap-y-[var(--space-1)]">
                  <span className="min-w-0">{fact.value}</span>
                  <span className="select-none" style={{ fontFamily: 'var(--font-sans)' }}>
                    <CopyLinkButton link={fact.copyLink.link} ariaLabel={fact.copyLink.ariaLabel} />
                  </span>
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {children}
    </section>
  )
}
