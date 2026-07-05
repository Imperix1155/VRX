import { useTranslation } from 'react-i18next'

/**
 * Small −/value/+ stepper for bounded integer settings (VRX-78).
 *
 * A11y: the value cell is a focusable `spinbutton` (aria-valuemin/max/now,
 * ArrowUp/Down and Home/End keys); the −/+ buttons carry their own labels and
 * are excluded from the Tab order (tabIndex −1) so the control is ONE Tab stop,
 * matching the roving-focus dialect of the segmented controls (audit W5).
 * Buttons never take the value out of [min, max]; at a bound the button
 * disables visually but stays in the DOM (no layout shift).
 */
export default function NumberStepper({
  value,
  min,
  max,
  onChange,
  ariaLabel
}: {
  value: number
  min: number
  max: number
  onChange: (next: number) => void
  ariaLabel: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const clamp = (n: number): number => Math.min(max, Math.max(min, n))
  const set = (n: number): void => {
    const next = clamp(n)
    if (next !== value) onChange(next)
  }

  // Buttons are CIRCLES (owner design round, VRX-187): the §3 concentric rule —
  // .glass pill 20px − 4px inset = 16px, which on a 24px button IS a circle
  // (same seating rule as the segmented bubble's 16px).
  const btnClass = (disabled: boolean): string =>
    [
      'grid h-[24px] w-[24px] place-items-center rounded-full border-0 text-[14px] font-semibold',
      'bg-[color-mix(in_srgb,var(--text)_8%,transparent)] motion-safe:transition-colors',
      disabled
        ? 'text-[var(--text-faint)] cursor-default'
        : 'text-[var(--text)] cursor-pointer hover:bg-[color-mix(in_srgb,var(--text)_14%,transparent)]'
    ].join(' ')

  return (
    <div className="glass flex items-center gap-[2px] p-[4px] shrink-0">
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('stepper.decrease')}
        disabled={value <= min}
        onClick={() => set(value - 1)}
        className={btnClass(value <= min)}
      >
        −
      </button>
      <span
        role="spinbutton"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
            e.preventDefault()
            set(value + 1)
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
            e.preventDefault()
            set(value - 1)
          } else if (e.key === 'Home') {
            e.preventDefault()
            set(min)
          } else if (e.key === 'End') {
            e.preventDefault()
            set(max)
          }
        }}
        // min-w-[36px] reserves THREE digits (owner, VRX-187): the pill's
        // silhouette never morphs as the value moves — shorter values center
        // in the fixed cell; tabular-nums keeps every digit the same width.
        className="min-w-[36px] text-center text-[12.5px] font-semibold tabular-nums text-[var(--text)] rounded-full outline-offset-2"
      >
        {value}
      </span>
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('stepper.increase')}
        disabled={value >= max}
        onClick={() => set(value + 1)}
        className={btnClass(value >= max)}
      >
        +
      </button>
    </div>
  )
}
