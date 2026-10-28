import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PICTURE_WARNING_KEYS,
  type BackgroundPicturePicker
} from '../hooks/useBackgroundPicturePicker'

/** The one line under the description: an error, else a fit warning, else nothing. */
export function BackgroundPictureMessage({
  picker
}: {
  picker: BackgroundPicturePicker
}): React.JSX.Element | null {
  const { t } = useTranslation()
  if (picker.errorKey !== null) {
    return (
      <p role="alert" className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
        {t(picker.errorKey)}
      </p>
    )
  }
  if (picker.warning === null) return null
  return (
    <p
      role="status"
      className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]"
      data-testid="background-picture-warning"
    >
      {t(PICTURE_WARNING_KEYS[picker.warning])}
    </p>
  )
}

/** The thumbnail, Choose or Change, and Remove once a picture is set.
 *  `oneLine` keeps them side by side in a narrow card (the welcome setup). */
export function BackgroundPictureControls({
  picker,
  oneLine = false
}: {
  picker: BackgroundPicturePicker
  oneLine?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const { dataUrl, busy } = picker
  const chooseButton = useRef<HTMLButtonElement>(null)
  const button = [
    'shrink-0 px-[var(--space-3)] py-[var(--space-1)] rounded-[10px] text-[13px] font-medium',
    'border border-[var(--border)]',
    'bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)]',
    'text-[var(--text)]',
    'focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)]',
    busy ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
  ].join(' ')
  return (
    <div
      className={`flex items-center justify-end gap-[var(--space-2)] ${oneLine ? 'flex-none' : 'flex-wrap'}`}
    >
      {dataUrl !== null && (
        <img
          src={dataUrl}
          alt=""
          className="background-picture-thumb"
          data-testid="background-picture-thumb"
          onLoad={(event) => picker.measure(event.currentTarget)}
        />
      )}
      <button
        ref={chooseButton}
        type="button"
        onClick={() => void picker.choose()}
        aria-disabled={busy || undefined}
        className={button}
      >
        {dataUrl === null
          ? t('settings.backgroundPicture.choose')
          : t('settings.backgroundPicture.change')}
      </button>
      {dataUrl !== null && (
        <button
          type="button"
          onClick={() =>
            void picker.remove().then((removed) => {
              // The Remove button is gone now; keep focus beside it.
              if (removed) chooseButton.current?.focus()
            })
          }
          aria-disabled={busy || undefined}
          className={button}
        >
          {t('settings.backgroundPicture.remove')}
        </button>
      )}
    </div>
  )
}
