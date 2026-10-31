/**
 * PlatformPill — the quiet platform label on a Dashboard hot-instance card (VRX-198).
 *
 * The card TINT + top stripe already carry the platform for anyone who can see
 * color; this pill is the §5 NON-COLOR signifier for colorblind / low-vision users.
 * It shares the instance pill's GEOMETRY (same footprint, so the two align in the
 * card's shared column). Its colors come from the --plat-*-badge-* tokens: a dim
 * ghost outline in dark (WCAG AA: CVR 6.2:1, VRC 5.5:1), a solid platform fill
 * with a white word in light, where an outline alone reads too faint to scan.
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
      data-platform-pill=""
      className={`${PILL_BASE} ${className}`}
      style={{
        color: isVrc ? 'var(--plat-vrc-badge-text)' : 'var(--plat-cvr-badge-text)',
        borderColor: isVrc ? 'var(--plat-vrc-badge-border)' : 'var(--plat-cvr-badge-border)',
        background: isVrc ? 'var(--plat-vrc-badge-bg)' : 'var(--plat-cvr-badge-bg)'
      }}
    >
      {isVrc ? t('dashboard.platformVrc') : t('dashboard.platformCvr')}
    </span>
  )
}
