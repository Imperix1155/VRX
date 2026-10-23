import { app, dialog } from 'electron'
import { mt, setMainLocale } from './i18n'

/**
 * Native error box shown just before the app exits on a fatal error, so a
 * failed launch is not silent. Localized and detail-free: error text and paths
 * stay in the log. Never throws, because the caller exits next either way.
 */
export function showFatalErrorBox(phase: 'startup' | 'runtime'): void {
  try {
    // The locale may not be set yet if startup failed early. Windows only
    // reports it after ready, so before ready the English copy is used.
    if (app.isReady()) setMainLocale(app.getLocale())
    dialog.showErrorBox(mt(`fatal.${phase}.title`), mt(`fatal.${phase}.message`))
  } catch {
    /* exiting anyway; the log already has the error */
  }
}
