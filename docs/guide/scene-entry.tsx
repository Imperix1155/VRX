import './production.css'
import '@renderer/i18n'
import './scene.css'
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { applyTheme } from '@renderer/hooks/useApplyTheme'
import { installFixtureBridge } from './fixture-bridge'

const params = new URLSearchParams(location.search)
const scene = params.get('scene') ?? 'dashboard'
const initialTheme = params.get('theme') === 'light' ? 'light' : 'dark'
applyTheme(initialTheme, false)
const root = document.getElementById('root')
if (root === null) throw new Error('Missing scene root')

function SceneFrame(): React.JSX.Element {
  const [theme, setTheme] = useState(initialTheme)
  const [glow, setGlow] = useState(params.get('glow') ?? 'standard')
  const [variant, setVariant] = useState(params.get('variant') ?? 'ready')
  const [grayscale, setGrayscale] = useState(false)
  const [reset, setReset] = useState(0)
  const query = new URLSearchParams({
    scene,
    theme,
    glow,
    variant,
    render: '1',
    reset: String(reset)
  })
  const variants =
    scene === 'updater'
      ? ['available', 'downloading', 'downloaded', 'idle']
      : scene === 'drawer'
        ? ['vrchat', 'chilloutvr']
        : scene === 'login'
          ? ['ready', 'totp', 'email']
          : scene === 'explore' || scene === 'feedback'
            ? ['ready', 'loading', 'stale', 'error', 'empty', 'unavailable']
            : ['ready']
  return (
    <div className="scene-frame">
      <div className="fixture-controls" aria-label="Example controls">
        <span className="fixture-label">Interactive fixture</span>
        <label>
          Theme{' '}
          <select
            value={theme}
            onChange={(event) => setTheme(event.target.value === 'light' ? 'light' : 'dark')}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
        <label>
          Glow{' '}
          <select value={glow} onChange={(event) => setGlow(event.target.value)}>
            <option value="muted">Muted</option>
            <option value="standard">Standard</option>
            <option value="vivid">Vivid</option>
          </select>
        </label>
        {variants.length > 1 && (
          <label>
            State{' '}
            <select value={variant} onChange={(event) => setVariant(event.target.value)}>
              {variants.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          <input
            type="checkbox"
            checked={grayscale}
            onChange={(event) => setGrayscale(event.target.checked)}
          />{' '}
          Grayscale
        </label>
        <button type="button" onClick={() => setReset((value) => value + 1)}>
          Reset sample
        </button>
      </div>
      <iframe
        className={grayscale ? 'scene-viewport scene-grayscale' : 'scene-viewport'}
        src={`./glass.html?${query.toString()}`}
        title={`${scene} production components, synthetic data`}
      />
      <div className="scene-caption">
        Real components · local sample data · actions never reach accounts or updates · source{' '}
        {__GUIDE_REVISION__.slice(0, 7)}
      </div>
    </div>
  )
}

if (params.get('render') === '1') {
  // The bridge is sealed before any connected component modules are evaluated.
  installFixtureBridge(window, params.get('variant') ?? 'ready')
  const { mountScene } = await import('./scene-renderer')
  mountScene(root, params)
} else {
  document.body.classList.add('scene-frame-document')
  createRoot(root).render(<SceneFrame />)
}
