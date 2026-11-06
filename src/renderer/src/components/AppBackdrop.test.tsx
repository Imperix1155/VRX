// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { appBackgroundKey, type AppBackgroundData } from '../queries/appBackground'
import { useSettingsStore } from '../stores/settings'
import AppBackdrop from './AppBackdrop'

const PICTURE = 'data:image/jpeg;base64,AAAA'

function renderBackdrop(data: AppBackgroundData): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(appBackgroundKey, data)
  render(
    <QueryClientProvider client={client}>
      <AppBackdrop />
    </QueryClientProvider>
  )
  return client
}

afterEach(() => {
  cleanup()
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS })
  document.documentElement.removeAttribute('data-app-background')
})

describe('AppBackdrop', () => {
  it('renders nothing and keeps the normal canvas without a picture', () => {
    renderBackdrop(null)
    expect(document.querySelector('.app-backdrop')).toBeNull()
    expect(document.documentElement.hasAttribute('data-app-background')).toBe(false)
  })

  it('shows the picture as hidden decoration with the chosen fade', () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, backgroundPictureFade: 'high' }
    })
    renderBackdrop({ dataUrl: PICTURE })
    const backdrop = document.querySelector('.app-backdrop')!
    expect(backdrop.getAttribute('aria-hidden')).toBe('true')
    expect(backdrop.getAttribute('data-fade')).toBe('high')
    expect(backdrop.querySelector('img')!.getAttribute('src')).toBe(PICTURE)
    expect(backdrop.querySelector('img')!.getAttribute('alt')).toBe('')
    expect(document.documentElement.hasAttribute('data-app-background')).toBe(true)
  })

  it('drops the picture and the canvas flag when it is removed', async () => {
    const client = renderBackdrop({ dataUrl: PICTURE })
    const next: AppBackgroundData = null
    // Query notifications are batched onto a timer.
    await act(async () => {
      client.setQueryData(appBackgroundKey, next)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(document.querySelector('.app-backdrop')).toBeNull()
    expect(document.documentElement.hasAttribute('data-app-background')).toBe(false)
  })

  it('falls back to the normal canvas when the picture cannot be shown', () => {
    renderBackdrop({ dataUrl: PICTURE })
    fireEvent.error(document.querySelector('.app-backdrop img')!)
    expect(document.querySelector('.app-backdrop')).toBeNull()
    expect(document.documentElement.hasAttribute('data-app-background')).toBe(false)
  })
})
