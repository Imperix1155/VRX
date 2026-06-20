import { useState } from 'react'

/**
 * VRX-4 token preview — a throwaway test surface that proves Tailwind v4 and the
 * design tokens (DESIGN.md §2/§2A) compile, render, and flip between themes.
 * The real app shell (§8) and the settings-driven theme toggle (VRX-115) replace
 * this later. Intentionally free of `window.electron` so it renders standalone.
 */
function Swatch({ label, swatchClass }: { label: string; swatchClass: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-[var(--space-3)]">
      <div
        className={`h-[var(--space-10)] w-[var(--space-10)] rounded-control border border-[var(--border)] ${swatchClass}`}
      />
      <span className="text-sm text-[var(--text-dim)]">{label}</span>
    </div>
  )
}

function TokenPreview(): React.JSX.Element {
  const [light, setLight] = useState(false)

  const toggleTheme = (): void => {
    const next = !light
    setLight(next)
    document.documentElement.dataset.theme = next ? 'light' : 'dark'
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-[var(--space-8)] p-[var(--space-10)]">
      <header className="flex items-center justify-between">
        <div className="font-mono text-5xl leading-none">
          <span className="text-[var(--vrc)]">V</span>
          <span className="text-[var(--bridge)]">R</span>
          <span className="text-[var(--cvr)]">X</span>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-control border border-[var(--border)] bg-[var(--control-fill)] px-[var(--space-4)] py-[var(--space-2)] text-sm text-[var(--text)] motion-safe:transition-colors hover:bg-[var(--control-fill-hover)]"
        >
          Theme: {light ? 'Light' : 'Dark'}
        </button>
      </header>

      <p className="text-[var(--text-faint)]">
        VRX-4 token preview — Tailwind v4 + DESIGN.md §2/§2A tokens. Toggle to verify the light
        override.
      </p>

      <section className="rounded-panel border border-[var(--border)] p-[var(--space-6)]">
        <h2 className="mb-[var(--space-4)] font-mono text-sm tracking-widest text-[var(--text-dim)] uppercase">
          Platform
        </h2>
        <div className="flex flex-col gap-[var(--space-3)]">
          <Swatch label="VRChat — var(--vrc)" swatchClass="bg-[var(--vrc)]" />
          <Swatch label="ChilloutVR — var(--cvr)" swatchClass="bg-[var(--cvr)]" />
          <Swatch label="Bridge — var(--bridge)" swatchClass="bg-[var(--bridge)]" />
        </div>
      </section>

      <section className="rounded-panel border border-[var(--border)] p-[var(--space-6)]">
        <h2 className="mb-[var(--space-4)] font-mono text-sm tracking-widest text-[var(--text-dim)] uppercase">
          Presence state
        </h2>
        <div className="flex flex-col gap-[var(--space-3)]">
          <Swatch label="In-game — var(--ingame)" swatchClass="bg-[var(--ingame)]" />
          <Swatch label="Active — var(--active)" swatchClass="bg-[var(--active)]" />
          <Swatch label="Offline — var(--offline)" swatchClass="bg-[var(--offline)]" />
        </div>
      </section>
    </div>
  )
}

export default TokenPreview
