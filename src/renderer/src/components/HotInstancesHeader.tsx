/**
 * Hot Instances header row (VRX-78, VRX-285): optional section heading, any
 * extra control (the Dashboard's "See all"), the quick-access threshold
 * stepper, and the quiet "?" help toggle with its inline explanation. Shared by
 * the Dashboard section and the Hot Instances page so both stay identical.
 */
import { forwardRef, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HOT_INSTANCE_THRESHOLD_MAX, HOT_INSTANCE_THRESHOLD_MIN } from '@shared/constants'
import { useSettingsStore } from '../stores/settings'
import NumberStepper from './NumberStepper'

interface HotInstancesHeaderProps {
  /** The section's `h2` (Dashboard). The page omits it: the TopBar owns its heading. */
  heading?: React.ReactNode
  /** Extra control placed before the stepper. */
  extra?: React.ReactNode
}

/** The ref reaches the threshold stepper: the sheet's stable focus fallback. */
const HotInstancesHeader = forwardRef<HTMLElement, HotInstancesHeaderProps>(
  function HotInstancesHeader({ heading, extra }, stepperRef) {
    const { t } = useTranslation()
    const [helpOpen, setHelpOpen] = useState(false)
    const helpId = useId()
    const threshold = useSettingsStore((s) => s.settings.hotInstanceThreshold)
    const updateSettings = useSettingsStore((s) => s.updateSettings)
    return (
      <>
        <div className="flex items-center justify-between gap-[var(--space-4)]">
          {heading ?? <span />}
          <div className="flex shrink-0 items-center gap-[var(--space-2)]">
            {extra}
            <NumberStepper
              ref={stepperRef}
              value={threshold}
              min={HOT_INSTANCE_THRESHOLD_MIN}
              max={HOT_INSTANCE_THRESHOLD_MAX}
              onChange={(next) => updateSettings({ hotInstanceThreshold: next })}
              ariaLabel={t('dashboard.hotThresholdAria')}
            />
            <button
              type="button"
              aria-label={t('dashboard.hotHelp.label')}
              title={t('dashboard.hotHelp.label')}
              aria-expanded={helpOpen}
              aria-controls={helpId}
              onClick={() => setHelpOpen((open) => !open)}
              className="glass grid h-[var(--space-8)] w-[var(--space-8)] shrink-0 place-items-center rounded-full text-sm font-semibold text-[var(--text-dim)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-dim)]"
            >
              <span aria-hidden="true">?</span>
            </button>
          </div>
        </div>
        <div
          id={helpId}
          hidden={!helpOpen}
          className="glass glass-information mb-[var(--space-3)] p-[var(--space-4)] text-sm leading-relaxed text-[var(--text-dim)]"
        >
          <p>{t('dashboard.hotHelp.description')}</p>
          <p className="mt-[var(--space-2)]">
            {t('dashboard.hotHelp.threshold', {
              min: HOT_INSTANCE_THRESHOLD_MIN,
              max: HOT_INSTANCE_THRESHOLD_MAX
            })}
          </p>
        </div>
      </>
    )
  }
)

export default HotInstancesHeader

/** Empty state when nothing reaches the threshold (Dashboard and Hot Instances page). */
export function HotInstancesEmpty({ threshold }: { threshold: number }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="glass glass-information flex flex-col items-center justify-center text-center p-[var(--space-10)] min-h-[180px]">
      <p className="text-[var(--text-dim)] text-sm font-semibold">{t('dashboard.emptyHeading')}</p>
      <p className="text-[var(--text-faint)] text-xs mt-[var(--space-1)]">
        {/* `threshold` (not `count`) — interpolation only, no plural-suffix lookup. */}
        {t('dashboard.emptyHint', { threshold })}
      </p>
    </div>
  )
}
