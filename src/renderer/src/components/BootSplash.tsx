import { useTranslation } from 'react-i18next'

/** Minimal cold-start surface shown while settings/auth checks settle. */
export default function BootSplash(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="grid min-h-screen place-items-center p-[var(--space-6)]">
      <div className="glass px-[var(--space-8)] py-[var(--space-6)] text-center">
        <div
          className="inline-block font-mono text-4xl leading-none tracking-wider"
          role="img"
          aria-label="VRX"
        >
          <span style={{ color: 'var(--vrc)' }}>V</span>
          <span style={{ color: 'var(--bridge)' }}>R</span>
          <span style={{ color: 'var(--cvr)' }}>X</span>
        </div>
        <p
          role="status"
          className="mt-[var(--space-3)] text-sm text-[var(--text-dim)] motion-safe:animate-pulse"
        >
          {t('boot.connecting')}
        </p>
      </div>
    </div>
  )
}
