import type { InputHTMLAttributes } from 'react'

/**
 * The ONE auth input style (VRX-221) — previously a ~200-char class string
 * duplicated across four inputs in LoginScreen and AccountCard. `focusClass`
 * carries the platform focus ring, the only per-platform part.
 */
export const AUTH_INPUT_CLASS =
  'w-full rounded-control border border-[var(--border)] bg-[var(--control-fill)] px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] hover:bg-[var(--control-fill-hover)] focus:outline-none focus:ring-1 disabled:opacity-50 motion-safe:transition-colors'

export default function AuthInput({
  focusClass,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & {
  focusClass: string
}): React.JSX.Element {
  return <input {...props} className={`${AUTH_INPUT_CLASS} ${focusClass}`} />
}
