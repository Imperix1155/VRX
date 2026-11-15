/**
 * The Activity page's two dialogs (owner, 2026-11-15): how long activity
 * stays saved on this computer, and the question before Clear deletes saved
 * activity. Both use the shared dialog shell.
 */
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { ACTIVITY_KEEP_FOR, type ActivityKeepFor } from '@shared/activity'
import { ACTIVITY_KEEP_LABEL_KEYS } from '../utils/activityText'
import LinkedDialog from './LinkedDialog'

const buttonClass =
  'rounded-control border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[12px] text-[var(--text)] hover:bg-[var(--surface-hover)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-dim)] motion-safe:transition-colors'

/** Pick how long activity is kept. A choice applies at once, like every
 *  setting; the dialog stays open so the note about deleting stays readable. */
export function ActivityKeepDialog({
  value,
  onChange,
  onClose
}: {
  value: ActivityKeepFor
  onChange: (value: ActivityKeepFor) => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const noteId = useId()
  const groupId = useId()
  return (
    <LinkedDialog title={t('activity.keep.title')} onClose={onClose}>
      <p id={noteId} className="text-[13px] text-[var(--text-dim)]">
        {t('activity.keep.note')}
      </p>
      <div
        role="radiogroup"
        aria-label={t('activity.keep.title')}
        aria-describedby={noteId}
        className="mt-[var(--space-3)] flex flex-col gap-[var(--space-1)]"
      >
        {ACTIVITY_KEEP_FOR.map((option) => (
          <label
            key={option}
            className="flex cursor-pointer items-center gap-[var(--space-3)] rounded-control px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--text)] hover:bg-[var(--surface-hover)] has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-[var(--text-dim)]"
          >
            <input
              type="radio"
              name={groupId}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="h-[14px] w-[14px] shrink-0 accent-[var(--text)] focus:outline-none"
            />
            <span>{t(ACTIVITY_KEEP_LABEL_KEYS[option])}</span>
          </label>
        ))}
      </div>
      <div className="mt-[var(--space-4)] flex justify-end">
        <button type="button" className={buttonClass} onClick={onClose}>
          {t('activity.keep.done')}
        </button>
      </div>
    </LinkedDialog>
  )
}

/** Asked before Clear when activity is saved: it deletes saved entries too. */
export function ActivityClearDialog({
  onConfirm,
  onClose
}: {
  onConfirm: () => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <LinkedDialog title={t('activity.clearConfirm.title')} onClose={onClose}>
      <p className="text-[13px] text-[var(--text-dim)]">{t('activity.clearConfirm.body')}</p>
      <div className="mt-[var(--space-4)] flex justify-end gap-[var(--space-2)]">
        <button type="button" className={buttonClass} onClick={onClose}>
          {t('activity.clearConfirm.cancel')}
        </button>
        <button
          type="button"
          className={`${buttonClass} font-semibold`}
          onClick={() => {
            onConfirm()
            onClose()
          }}
        >
          {t('activity.clearConfirm.confirm')}
        </button>
      </div>
    </LinkedDialog>
  )
}
