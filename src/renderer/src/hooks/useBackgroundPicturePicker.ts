import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AppBackgroundResult } from '@shared/ipc'
import { backgroundPictureWarning, type BackgroundPictureWarning } from '@shared/backgroundPicture'
import { chooseAppBackground, clearAppBackground, useAppBackground } from '../queries/appBackground'

/**
 * Background picture (owner, 2026-10-26): main opens the picture dialog and
 * keeps its own copy; the renderer only ever sees the kept copy's data URL.
 * Main refuses pictures that cannot fill the window; a usable picture that
 * will be cropped hard or look soft gets one warning line, read from the
 * thumbnail's own size. Settings → Appearance and the welcome setup's Look
 * step (owner, 2026-10-28) share this picker so both behave the same.
 */

/** A cancelled dialog is not an error. */
const PICTURE_ERROR_KEYS: Record<
  Extract<AppBackgroundResult, { ok: false }>['reason'],
  string | null
> = {
  cancelled: null,
  unsupported: 'settings.backgroundPicture.error.unsupported',
  'too-large': 'settings.backgroundPicture.error.tooLarge',
  'too-small': 'settings.backgroundPicture.error.tooSmall',
  'too-tall': 'settings.backgroundPicture.error.tooTall',
  'too-wide': 'settings.backgroundPicture.error.tooWide',
  unreadable: 'settings.backgroundPicture.error.unreadable',
  'save-failed': 'settings.backgroundPicture.error.saveFailed'
}

export const PICTURE_WARNING_KEYS: Record<BackgroundPictureWarning, string> = {
  tall: 'settings.backgroundPicture.warning.tall',
  wide: 'settings.backgroundPicture.warning.wide',
  'low-res': 'settings.backgroundPicture.warning.lowRes'
}

export interface BackgroundPicturePicker {
  dataUrl: string | null
  busy: boolean
  errorKey: string | null
  warning: BackgroundPictureWarning | null
  choose: () => Promise<void>
  /** Resolves true once the picture is gone. */
  remove: () => Promise<boolean>
  measure: (image: HTMLImageElement) => void
}

/** Choose and remove state for one picker; see `components/BackgroundPicturePicker`. */
export function useBackgroundPicturePicker(): BackgroundPicturePicker {
  const queryClient = useQueryClient()
  const { data } = useAppBackground()
  const [busy, setBusy] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const dataUrl = data?.dataUrl ?? null
  const [fit, setFit] = useState<{ url: string; warning: BackgroundPictureWarning | null } | null>(
    null
  )
  const warning = fit !== null && fit.url === dataUrl ? fit.warning : null

  const choose = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setErrorKey(null)
    const result = await chooseAppBackground(queryClient)
    setBusy(false)
    if (!result.ok) setErrorKey(PICTURE_ERROR_KEYS[result.reason])
  }
  const remove = async (): Promise<boolean> => {
    if (busy) return false
    setBusy(true)
    setErrorKey(null)
    const removed = await clearAppBackground(queryClient)
    setBusy(false)
    if (!removed) setErrorKey('settings.backgroundPicture.error.removeFailed')
    return removed
  }
  const measure = (image: HTMLImageElement): void => {
    if (dataUrl === null) return
    setFit({
      url: dataUrl,
      warning: backgroundPictureWarning(image.naturalWidth, image.naturalHeight)
    })
  }

  return { dataUrl, busy, errorKey, warning, choose, remove, measure }
}
