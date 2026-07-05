import { useTranslation } from 'react-i18next'
import { useSegmentedBubble } from '../hooks/useSegmentedBubble'
import { focusRadioSibling, segArrowTarget } from '../utils/segmented'

/**
 * Segmented control (§9 pattern) shared by the settings rows. Radius: .glass's
 * 20px panel radius wins over any `rounded-[..]` here (see TopBar), so the
 * bubble is rounded-[16px] (= 20px − 4px inset) to seat concentrically into
 * the track. A11y (audit W5): radiogroup + roving tabindex — one Tab stop,
 * arrows move the selection (same dialect as the TopBar filter).
 */
export default function SegmentedControl<T extends string>({
  values,
  active,
  labelKeys,
  ariaLabel,
  onChange
}: {
  values: readonly T[]
  active: T
  labelKeys: Record<T, string>
  ariaLabel: string
  onChange: (value: T) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const activeIndex = values.indexOf(active)

  // Sliding bubble measured from the active button — labels are unequal widths
  // ("VRChat" vs "Per platform"), so the old fixed 1/N-width CSS-calc bubble
  // could not line up (it sat 10.5px off on the theme row's "System").
  const { trackRef, bubble } = useSegmentedBubble(activeIndex)

  return (
    <div
      ref={trackRef}
      className="glass relative flex p-[4px] gap-[2px] shrink-0"
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {/* Sliding bubble — left/width measured from the active button (see above) */}
      <span
        className="absolute top-[4px] bottom-[4px] rounded-[16px] pointer-events-none motion-safe:transition-all motion-safe:duration-200"
        style={{
          left: `${bubble.left}px`,
          width: `${bubble.width}px`,
          background: 'var(--seg-bubble-bg)',
          boxShadow: 'var(--seg-bubble-shadow)'
        }}
        aria-hidden="true"
      />
      {values.map((value, index) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={active === value}
          tabIndex={active === value ? 0 : -1}
          onClick={() => onChange(value)}
          onKeyDown={(e) => {
            const next = segArrowTarget(e.key, index, values.length)
            const nextValue = next === null ? undefined : values[next]
            if (next === null || nextValue === undefined) return
            e.preventDefault()
            onChange(nextValue)
            focusRadioSibling(e.currentTarget, next)
          }}
          className={[
            'relative z-10 flex-1 text-[12.5px] font-semibold px-[13px] py-[6px] rounded-[9px]',
            'border-0 bg-transparent cursor-pointer motion-safe:transition-colors whitespace-nowrap',
            active === value ? 'text-[var(--text)]' : 'text-[var(--text-dim)]'
          ].join(' ')}
        >
          {t(labelKeys[value])}
        </button>
      ))}
    </div>
  )
}
