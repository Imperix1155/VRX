/**
 * The grab bar at the top of every bottom sheet. It is a real control: drag
 * it up for more, down for less (or down again to close), or click it, press
 * Enter or Space, or use Arrow Up and Arrow Down. The whole row is the target,
 * so the small pill never has to be hit exactly.
 */
import { useTranslation } from 'react-i18next'
import type { SheetExpansion } from '../hooks/useSheetExpansion'

export default function SheetGrabBar({
  expansion
}: {
  expansion: SheetExpansion
}): React.JSX.Element {
  const { t } = useTranslation()
  const label = t(expansion.expanded ? 'sheet.showLess' : 'sheet.showMore')
  return (
    <button
      type="button"
      data-sheet-grab-bar=""
      aria-label={label}
      title={t(expansion.expanded ? 'sheet.collapseHint' : 'sheet.expandHint')}
      {...expansion.handleProps}
      className={`group flex w-full shrink-0 touch-none select-none justify-center pt-[var(--space-3)] pb-[var(--space-2)] focus:outline-none ${
        expansion.dragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
    >
      <span
        aria-hidden="true"
        className={`block h-[4px] rounded-full group-hover:bg-[var(--text-faint)] group-focus-visible:bg-[var(--text-dim)] group-focus-visible:ring-1 group-focus-visible:ring-[var(--text-dim)] group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-[var(--glass-information)] motion-safe:transition-[width,background-color] motion-safe:duration-[180ms] ${
          expansion.dragging
            ? 'w-[56px] bg-[var(--text-dim)]'
            : 'w-[44px] bg-[var(--border)] group-hover:w-[52px]'
        }`}
      />
    </button>
  )
}
