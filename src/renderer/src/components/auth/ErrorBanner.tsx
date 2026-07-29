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
      className={`flex items-center gap-[var(--space-2)] text-sm text-[var(--error)]${className ? ` ${className}` : ''}`}
      role="alert"
    >
      <span aria-hidden="true">⚠</span>
      {t(errorKey)}
    </p>
  )
}
