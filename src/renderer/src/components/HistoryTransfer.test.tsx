// @vitest-environment jsdom
/**
 * Activity → Kept → Move your history (owner, 2026-11-15): three buttons.
 * Main does the work and owns the file dialogs; this says what happened in
 * words, asks before a restore, and stays quiet when a dialog was cancelled.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  HistoryBackupResult,
  HistoryRestoreResult,
  VrcxHistoryImportResult
} from '@shared/historyTransfer'
import i18n from '../i18n'
import { translate as msg } from '../i18n/translate'
import HistoryTransfer from './HistoryTransfer'

let importVrcxHistory: ReturnType<typeof vi.fn<() => Promise<VrcxHistoryImportResult>>>
let backupHistory: ReturnType<typeof vi.fn<() => Promise<HistoryBackupResult>>>
let restoreHistory: ReturnType<typeof vi.fn<() => Promise<HistoryRestoreResult>>>

const button = (key: string): HTMLElement => screen.getByRole('button', { name: msg(key) })
const result = (): HTMLElement => screen.getByRole('status')

beforeEach(() => {
  importVrcxHistory = vi.fn<() => Promise<VrcxHistoryImportResult>>(async () => ({
    ok: true,
    friendsSince: 38,
    names: 6,
    visits: 412,
    olderSkipped: false
  }))
  backupHistory = vi.fn<() => Promise<HistoryBackupResult>>(async () => ({ ok: true }))
  restoreHistory = vi.fn<() => Promise<HistoryRestoreResult>>(async () => ({ ok: true }))
  ;(window as unknown as { vrx?: unknown }).vrx = {
    importVrcxHistory,
    backupHistory,
    restoreHistory
  }
})

afterEach(() => {
  cleanup()
  ;(window as unknown as { vrx?: unknown }).vrx = undefined
  void i18n.changeLanguage('en')
})

describe('Move your history', () => {
  it('starts nothing until a button is pressed', () => {
    render(<HistoryTransfer saving />)
    expect(result().textContent).toBe('')
    expect(importVrcxHistory).not.toHaveBeenCalled()
    expect(backupHistory).not.toHaveBeenCalled()
    expect(restoreHistory).not.toHaveBeenCalled()
  })

  it('says what VRCX brought in, in words, and what was left out', async () => {
    importVrcxHistory.mockResolvedValueOnce({
      ok: true,
      friendsSince: 38,
      names: 6,
      visits: 412,
      olderSkipped: true
    })
    render(<HistoryTransfer saving />)
    fireEvent.click(button('activity.transfer.importVrcx'))
    await waitFor(() =>
      expect(result().textContent).toBe(
        `${msg('activity.transfer.imported', { visits: 412, friends: 38, names: 6 })}\n${msg('activity.transfer.importedOlder')}`
      )
    )
    expect(importVrcxHistory).toHaveBeenCalledExactlyOnceWith()
  })

  it('says when VRCX had nothing new', async () => {
    importVrcxHistory.mockResolvedValueOnce({
      ok: true,
      friendsSince: 0,
      names: 0,
      visits: 0,
      olderSkipped: false
    })
    render(<HistoryTransfer saving />)
    fireEvent.click(button('activity.transfer.importVrcx'))
    await waitFor(() => expect(result().textContent).toBe(msg('activity.transfer.importedNothing')))
  })

  it.each([
    ['busy', 'activity.transfer.importBusy'],
    ['not-found', 'activity.transfer.importNotFound'],
    ['no-history', 'activity.transfer.importNoHistory'],
    ['signed-out', 'activity.transfer.importSignedOut'],
    ['failed', 'activity.transfer.importFailed'],
    ['rate-limited', 'activity.transfer.tooMany']
  ] as const)('explains a refused import (%s)', async (reason, key) => {
    importVrcxHistory.mockResolvedValueOnce({ ok: false, reason })
    render(<HistoryTransfer saving />)
    fireEvent.click(button('activity.transfer.importVrcx'))
    await waitFor(() => expect(result().textContent).toBe(msg(key)))
  })

  it('saves a backup and stays quiet when the dialog was cancelled', async () => {
    render(<HistoryTransfer saving />)
    fireEvent.click(button('activity.transfer.backup'))
    await waitFor(() => expect(result().textContent).toBe(msg('activity.transfer.backedUp')))

    backupHistory.mockResolvedValueOnce({ ok: false, reason: 'cancelled' })
    fireEvent.click(button('activity.transfer.backup'))
    await waitFor(() => expect(result().textContent).toBe(''))
    expect(backupHistory).toHaveBeenCalledTimes(2)
  })

  it('asks before a restore, and Cancel starts nothing', () => {
    render(<HistoryTransfer saving />)
    fireEvent.click(button('activity.transfer.restore'))
    expect(screen.getByText(msg('activity.transfer.restoreAsk'))).toBeTruthy()
    expect(restoreHistory).not.toHaveBeenCalled()
    fireEvent.click(button('activity.transfer.cancel'))
    expect(screen.queryByText(msg('activity.transfer.restoreAsk'))).toBeNull()
    expect(restoreHistory).not.toHaveBeenCalled()
  })

  it('restores after the question is answered', async () => {
    render(<HistoryTransfer saving />)
    fireEvent.click(button('activity.transfer.restore'))
    fireEvent.click(button('activity.transfer.restoreConfirm'))
    await waitFor(() => expect(result().textContent).toBe(msg('activity.transfer.restored')))
    expect(restoreHistory).toHaveBeenCalledExactlyOnceWith()
  })

  it.each([
    ['not-a-backup', 'activity.transfer.restoreNotBackup'],
    ['newer', 'activity.transfer.restoreNewer'],
    ['failed', 'activity.transfer.restoreFailed']
  ] as const)('explains a refused restore (%s)', async (reason, key) => {
    restoreHistory.mockResolvedValueOnce({ ok: false, reason })
    render(<HistoryTransfer saving />)
    fireEvent.click(button('activity.transfer.restore'))
    fireEvent.click(button('activity.transfer.restoreConfirm'))
    await waitFor(() => expect(result().textContent).toBe(msg(key)))
  })

  it('runs one at a time', async () => {
    let finish: (value: VrcxHistoryImportResult) => void = () => undefined
    importVrcxHistory.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    render(<HistoryTransfer saving />)
    fireEvent.click(button('activity.transfer.importVrcx'))
    expect(result().textContent).toBe(msg('activity.transfer.working.import'))
    fireEvent.click(button('activity.transfer.importVrcx'))
    fireEvent.click(button('activity.transfer.backup'))
    fireEvent.click(button('activity.transfer.restore'))
    expect(importVrcxHistory).toHaveBeenCalledTimes(1)
    expect(backupHistory).not.toHaveBeenCalled()
    expect(screen.queryByText(msg('activity.transfer.restoreAsk'))).toBeNull()
    finish({ ok: false, reason: 'busy' })
    await waitFor(() => expect(result().textContent).toBe(msg('activity.transfer.importBusy')))
  })

  it('does nothing while activity is kept only until VRX closes, and says why', () => {
    render(<HistoryTransfer saving={false} />)
    expect(result().textContent).toBe(msg('activity.transfer.off'))
    for (const key of ['importVrcx', 'backup', 'restore']) {
      const control = button(`activity.transfer.${key}`)
      expect(control.getAttribute('aria-disabled')).toBe('true')
      fireEvent.click(control)
    }
    expect(importVrcxHistory).not.toHaveBeenCalled()
    expect(backupHistory).not.toHaveBeenCalled()
    expect(screen.queryByText(msg('activity.transfer.restoreAsk'))).toBeNull()
  })

  it('reads the same in Japanese', async () => {
    await i18n.changeLanguage('ja')
    render(<HistoryTransfer saving />)
    fireEvent.click(button('activity.transfer.backup'))
    await waitFor(() => expect(result().textContent).toBe(msg('activity.transfer.backedUp')))
    expect(result().textContent).toContain('バックアップ')
  })
})
