import { useLayoutEffect, useState } from 'react'
import { useAppBackground } from '../queries/appBackground'
import { useSettingsStore } from '../stores/settings'

/**
 * The user's own background picture behind the whole app (Settings →
 * Appearance). `data-app-background` on <html> drops the aurora's opaque floor
 * so the picture shows through; any glow the user keeps sits on top. Purely
 * decorative: hidden from assistive technology.
 */
export default function AppBackdrop(): React.JSX.Element | null {
  const { data } = useAppBackground()
  const fade = useSettingsStore((s) => s.settings.backgroundPictureFade)
  const dataUrl = data?.dataUrl ?? null
  // A picture the renderer cannot decode falls back to the normal canvas.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)
  const shown = dataUrl !== null && dataUrl !== brokenUrl

  useLayoutEffect(() => {
    if (!shown) return
    const root = document.documentElement
    root.setAttribute('data-app-background', '')
    return () => root.removeAttribute('data-app-background')
  }, [shown])

  if (!shown) return null
  return (
    <div className="app-backdrop" data-fade={fade} aria-hidden="true">
      <img src={dataUrl} alt="" decoding="async" onError={() => setBrokenUrl(dataUrl)} />
    </div>
  )
}
