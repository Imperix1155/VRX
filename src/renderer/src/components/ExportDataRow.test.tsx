// @vitest-environment jsdom
/**
 * Settings → Accounts → Export your data (owner, 2026-11-11): one button.
 * Main builds the file and owns the save dialog; the row says what happened
 * in words and stays quiet when the dialog was cancelled.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataExportResult } from '@shared/ipc'
import i18n from '../i18n'
import { translate as msg } from '../i18n/translate'
import ExportDataRow from './ExportDataRow'
let exportData: ReturnType<typeof vi.fn<() => Promise<DataExportResult>>>

const button = (): HTMLElement =>
  screen.getByRole('button', { name: msg('settings.export.button') })
const result = (): HTMLElement => screen.getByRole('status')

beforeEach(() => {
  exportData = vi.fn<() => Promise<DataExportResult>>(async () => ({
    ok: true,
    friends: 212,
    notes: 14,
    favorites: 31,
    gameFavoritesMissing: false
  }))
  ;(window as unknown as { vrx?: unknown }).vrx = { exportData }
})

afterEach(() => {
  cleanup()
  ;(window as unknown as { vrx?: unknown }).vrx = undefined
  void i18n.changeLanguage('en')
})

describe('Export your data', () => {
  it('shows a label, one line of description and a quiet result line', () => {
    render(<ExportDataRow />)
    expect(screen.getByText(msg('settings.export.label'))).toBeTruthy()
    expect(screen.getByText(msg('settings.export.description'))).toBeTruthy()
    expect(result().textContent).toBe('')
    expect(exportData).not.toHaveBeenCalled()
  })

  it('asks main once per press, with nothing in the request', async () => {
    render(<ExportDataRow />)
    fireEvent.click(button())
    await waitFor(() => expect(result().textContent).not.toBe(''))
    expect(exportData).toHaveBeenCalledExactlyOnceWith()
  })

  it('says how much was saved, in words', async () => {
    render(<ExportDataRow />)
    fireEvent.click(button())
    await waitFor(() =>
      expect(result().textContent).toBe(
        msg('settings.export.saved', { friends: 212, notes: 14, favorites: 31 })
      )
    )
    expect(result().textContent).toContain('212')
    expect(result().getAttribute('data-export-result')).toBe('saved')
  })

  it('adds a sentence when the game favorites could not be included', async () => {
    exportData.mockResolvedValue({
      ok: true,
      friends: 3,
      notes: 0,
      favorites: 1,
      gameFavoritesMissing: true
    })
    render(<ExportDataRow />)
    fireEvent.click(button())
    await waitFor(() =>
      expect(result().textContent).toBe(
        `${msg('settings.export.saved', { friends: 3, notes: 0, favorites: 1 })} ${msg('settings.export.noGameFavorites')}`
      )
    )
  })

  it('reads the same with one of something: no plural to get wrong', async () => {
    exportData.mockResolvedValue({
      ok: true,
      friends: 1,
      notes: 1,
      favorites: 1,
      gameFavoritesMissing: false
    })
    render(<ExportDataRow />)
    fireEvent.click(button())
    await waitFor(() =>
      expect(result().textContent).toBe('Saved. Friends: 1, notes: 1, favorites: 1.')
    )
  })

  it('counts several presses in one moment as one', () => {
    exportData.mockImplementation(() => new Promise<DataExportResult>(() => undefined))
    render(<ExportDataRow />)
    const target = button()
    // No render happens between these: state alone would let all three through.
    act(() => {
      target.click()
      target.click()
      target.click()
    })
    expect(exportData).toHaveBeenCalledTimes(1)
  })

  it('says nothing when the save dialog was cancelled', async () => {
    exportData.mockResolvedValue({ ok: false, reason: 'cancelled' })
    render(<ExportDataRow />)
    fireEvent.click(button())
    await waitFor(() => expect(button().getAttribute('aria-disabled')).toBe('false'))
    expect(result().textContent).toBe('')
  })

  it.each([
    ['signed-out', 'settings.export.signedOut'],
    ['not-ready', 'settings.export.notReady'],
    ['stale', 'settings.export.accountChanged'],
    ['save-failed', 'settings.export.failed'],
    ['rate-limited', 'settings.export.tooMany']
  ] as const)('explains %s in a sentence', async (reason, key) => {
    exportData.mockResolvedValue({ ok: false, reason })
    render(<ExportDataRow />)
    fireEvent.click(button())
    await waitFor(() => expect(result().textContent).toBe(msg(key)))
  })

  it('treats a refused or broken call as a failed save', async () => {
    exportData.mockRejectedValue(new Error('IPC rate limit exceeded'))
    render(<ExportDataRow />)
    fireEvent.click(button())
    await waitFor(() => expect(result().textContent).toBe(msg('settings.export.failed')))
    expect(button().getAttribute('aria-disabled')).toBe('false')
  })

  it('says it failed when the bridge is missing', () => {
    ;(window as unknown as { vrx?: unknown }).vrx = undefined
    render(<ExportDataRow />)
    fireEvent.click(button())
    expect(result().textContent).toBe(msg('settings.export.failed'))
  })

  it('ignores presses while the dialog is open, then works again', async () => {
    let finish: (value: DataExportResult) => void = () => undefined
    exportData.mockImplementation(
      () =>
        new Promise<DataExportResult>((resolve) => {
          finish = resolve
        })
    )
    render(<ExportDataRow />)
    fireEvent.click(button())
    fireEvent.click(button())
    fireEvent.click(button())
    expect(exportData).toHaveBeenCalledTimes(1)
    expect(button().getAttribute('aria-disabled')).toBe('true')
    await act(async () => {
      finish({ ok: false, reason: 'cancelled' })
    })
    await waitFor(() => expect(button().getAttribute('aria-disabled')).toBe('false'))
    fireEvent.click(button())
    expect(exportData).toHaveBeenCalledTimes(2)
  })

  it('clears the last result when a new export starts', async () => {
    render(<ExportDataRow />)
    fireEvent.click(button())
    await waitFor(() => expect(result().textContent).not.toBe(''))
    exportData.mockImplementation(() => new Promise<DataExportResult>(() => undefined))
    fireEvent.click(button())
    expect(result().textContent).toBe('')
  })

  it('does not touch state after the page is left mid-export', async () => {
    let finish: (value: DataExportResult) => void = () => undefined
    exportData.mockImplementation(
      () =>
        new Promise<DataExportResult>((resolve) => {
          finish = resolve
        })
    )
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const view = render(<ExportDataRow />)
    fireEvent.click(button())
    view.unmount()
    await act(async () => {
      finish({ ok: true, friends: 1, notes: 0, favorites: 0, gameFavoritesMissing: false })
    })
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('reads in Japanese too', async () => {
    await i18n.changeLanguage('ja')
    render(<ExportDataRow />)
    fireEvent.click(button())
    await waitFor(() => expect(result().textContent).toContain('212'))
    expect(result().textContent).toBe(
      msg('settings.export.saved', { friends: 212, notes: 14, favorites: 31 })
    )
  })
})
