/**
 * PolicySpacePill — the non-actionable moderation-context pill.
 *
 * Rose means Public space, Ice means Private space, and unconfirmed contexts
 * reuse the app's neutral treatment. The visible words remain the non-color
 * signifier in every theme.
 */
import { useTranslation } from 'react-i18next'
import type { PolicySpace } from '../utils/instancePolicySpace'
import { PILL_BASE } from '../utils/instancePill'

const LABEL_KEYS: Record<PolicySpace, string> = {
  public: 'policySpace.public',
  private: 'policySpace.private',
  unknown: 'policySpace.unknown'
}

interface PolicySpacePillProps {
  space: PolicySpace
  className?: string
}

export default function PolicySpacePill({
  space,
  className = ''
}: PolicySpacePillProps): React.JSX.Element {
  const { t } = useTranslation()
  const style: React.CSSProperties & { '--policy-space-pill-bg': string } =
    space === 'unknown'
      ? {
          color: 'var(--text-dim)',
          '--policy-space-pill-bg': 'color-mix(in srgb, var(--text) 7%, transparent)',
          borderColor: 'color-mix(in srgb, var(--text) 16%, transparent)'
        }
      : {
          color: `var(--policy-${space}-text)`,
          '--policy-space-pill-bg': `color-mix(in srgb, var(--policy-${space}) 13%, transparent)`,
          borderColor: `color-mix(in srgb, var(--policy-${space}) 36%, transparent)`
        }

  return (
    <span
      data-policy-space-pill=""
      data-policy-space={space}
      className={`${PILL_BASE} bg-[var(--policy-space-pill-bg)] ${className}`}
      style={style}
    >
      {t(LABEL_KEYS[space])}
    </span>
  )
}
