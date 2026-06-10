import { useTranslation } from 'react-i18next'

/**
 * Temporary demo surface proving the i18next wiring (VRX-14): the `useTranslation`
 * hook renders a translated string and reflects the active language. Remove once
 * real localized UI lands.
 */
export default function LocaleProbe(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  return (
    <p>
      {t('greeting')} ({i18n.language})
    </p>
  )
}
