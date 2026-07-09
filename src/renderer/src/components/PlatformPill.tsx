/**
 * PlatformPill — the quiet platform label on a Dashboard hot-instance card (VRX-198).
 *
 * The card TINT + top stripe already carry the platform for anyone who can see
 * color; this pill is the §5 NON-COLOR signifier for colorblind / low-vision users.
 * So it's deliberately the lowest-weight element (World → Instance → Who's-here →
 * Platform): the shared pill GEOMETRY (matches the instance pill's footprint, so the
 * two align in the card's shared column), but a DIM ghost outline — no fill, thin
 * border. The LABEL stays legible (WCAG AA: CVR 6.2:1, VRC 5.5:1 dark; re-verified
 * light) — the quietness lives in the pill, never the word.
 */
import { useTranslation } from 'react-i18next'
import type { Platform } from '@shared/types'
import { PILL_BASE } from '../utils/instancePill'

interface PlatformPillProps {
  platform: Platform
  /** Grid placement from the consumer (the card floors the shared pill column). */
  className?: string
}

export default function PlatformPill({
  platform,
  className = ''
}: PlatformPillProps): React.JSX.Element {
  const { t } = useTranslation()
  const isVrc = platform === 'vrchat'
  return (
    <span
      className={`${PILL_BASE} ${className}`}
      style={{
        color: isVrc ? 'var(--plat-vrc-ghost-text)' : 'var(--plat-cvr-ghost-text)',
        borderColor: isVrc ? 'var(--plat-vrc-ghost-border)' : 'var(--plat-cvr-ghost-border)',
        background: 'transparent'
      }}
    >
      {isVrc ? t('dashboard.platformVrc') : t('dashboard.platformCvr')}
    </span>
  )
}
