/**
 * Compact boolean setting control. A real switch button gives one Tab stop and
 * exposes its state without relying on color; the knob position is the visible
 * non-color signifier.
 */
export default function Toggle({
  checked,
  onChange,
  ariaLabel
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  ariaLabel: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className="relative h-[var(--space-6)] w-[var(--space-10)] shrink-0 cursor-pointer rounded-full border border-[var(--border)] p-[var(--space-1)] motion-safe:transition-colors"
      style={{
        background: checked ? 'var(--control-active-bg)' : 'var(--control-fill)',
        boxShadow: checked ? 'var(--control-active-shadow)' : undefined
      }}
    >
      <span
        aria-hidden="true"
        className="block h-[var(--space-4)] w-[var(--space-4)] rounded-full bg-[var(--text)] motion-safe:transition-transform motion-safe:duration-200"
        style={{ transform: checked ? 'translateX(var(--space-4))' : 'translateX(0)' }}
      />
    </button>
  )
}
