import { useSyncExternalStore } from 'react'

/**
 * Whether the VRX window has keyboard focus. Endless animations use this to run
 * only while VRX is in front: an always-running CSS animation keeps the
 * compositor drawing every frame even while VRX sits behind a game.
 */
export function useWindowFocused(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('focus', onChange)
  window.addEventListener('blur', onChange)
  return () => {
    window.removeEventListener('focus', onChange)
    window.removeEventListener('blur', onChange)
  }
}

function getSnapshot(): boolean {
  return document.hasFocus()
}

function getServerSnapshot(): boolean {
  return true
}
