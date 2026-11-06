import { useTranslation } from 'react-i18next'

/**
 * The shared auth error banner (VRX-221) — `--error` token + a non-color glyph
 * (DESIGN.md R2/R10: color + glyph, never color alone), role="alert".
 */
export default function ErrorBanner({
  errorKey,
  className
}: {
  errorKey: string | null
  className?: string
}): React.JSX.Element | null {
  const { t } = useTranslation()
  if (!errorKey) return null
  return (
    <p
      className={`flex items-start gap-[var(--space-2)] text-sm text-[var(--error)]${className ? ` ${className}` : ''}`}
      role="alert"
    >
      {/* Beside the first line, so a long message reads from the warning sign. */}
      <span aria-hidden="true" className="shrink-0">
        ⚠
      </span>
      {t(errorKey)}
    </p>
  )
}
