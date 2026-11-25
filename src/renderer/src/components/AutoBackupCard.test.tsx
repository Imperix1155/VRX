// @vitest-environment jsdom
/**
 * Settings → Accounts → Back up automatically. The switch starts off, a
 * restore asks before it calls main, and the call carries the copy's name.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AutoBackupFolderResult,
  AutoBackupRestoreResult,
  AutoBackupStatus
} from '@shared/autoBackup'
import { DEFAULT_SETTINGS } from '@shared/settings'
import i18n from '../i18n'
import { translate as msg } from '../i18n/translate'
import { useSettingsStore } from '../stores/settings'
import AutoBackupCard from './AutoBackupCard'

const realUpdate = useSettingsStore.getState().updateSettings

let getAutoBackup: ReturnType<typeof vi.fn<() => Promise<AutoBackupStatus>>>
let restoreAutoBackup: ReturnType<
  typeof vi.fn<(req: { id: string }) => Promise<AutoBackupRestoreResult>>
>
let chooseAutoBackupFolder: ReturnType<typeof vi.fn<() => Promise<AutoBackupFolderResult>>>

const idle = (): AutoBackupStatus => ({
  usingDefaultFolder: true,
  folderName: 'backups',
  lastBackupAt: null,
  lastError: null,
  copies: []
})

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (): void {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (): void {
    this.removeAttribute('open')
  }
  getAutoBackup = vi.fn<() => Promise<AutoBackupStatus>>(async () => idle())
  restoreAutoBackup = vi.fn<(req: { id: string }) => Promise<AutoBackupRestoreResult>>(
    async () => ({
      ok: true
    })
  )
  chooseAutoBackupFolder = vi.fn<() => Promise<AutoBackupFolderResult>>(async () => ({
    ok: false,
    reason: 'cancelled'
  }))
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, updateSettings: realUpdate })
  ;(window as unknown as { vrx?: unknown }).vrx = {
    getAutoBackup,
    restoreAutoBackup,
    chooseAutoBackupFolder,
    resetAutoBackupFolder: async () => ({ usingDefaultFolder: true, folderName: 'backups' }),
    onAutoBackupChanged: () => () => undefined,
    onIdentityBoundary: () => () => undefined
  }
})

afterEach(() => {
  cleanup()
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, updateSettings: realUpdate })
  ;(window as unknown as { vrx?: unknown }).vrx = undefined
  void i18n.changeLanguage('en')
})

describe('Back up automatically', () => {
  it('starts off and hides how often until it is on', () => {
    render(<AutoBackupCard />)
    expect(
      screen.getByRole('radio', { name: msg('settings.boolean.off') }).getAttribute('aria-checked')
    ).toBe('true')
    expect(
      screen.queryByRole('radiogroup', { name: msg('settings.autoBackup.interval.aria') })
    ).toBeNull()
  })

  it('turns automatic backup on', () => {
    const updateSettings = vi.fn()
    useSettingsStore.setState({ updateSettings })
    render(<AutoBackupCard />)
    fireEvent.click(screen.getByRole('radio', { name: msg('settings.boolean.on') }))
    expect(updateSettings).toHaveBeenCalledWith({ autoBackup: true })
  })

  it('shows when the last backup was made', async () => {
    const lastBackupAt = Date.UTC(2026, 10, 25, 5, 33)
    getAutoBackup.mockResolvedValue({ ...idle(), lastBackupAt })
    render(<AutoBackupCard />)
    const time = new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(lastBackupAt)
    await waitFor(() =>
      expect(screen.getByText(msg('settings.autoBackup.last', { time })).textContent).toBe(
        msg('settings.autoBackup.last', { time })
      )
    )
  })

  it('says when the backup folder cannot be used', async () => {
    getAutoBackup.mockResolvedValue({ ...idle(), lastError: 'folder' })
    render(<AutoBackupCard />)
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(msg('settings.autoBackup.error.folder'))
    )
  })

  it('asks before restoring and sends the copy name', async () => {
    const id = 'vrx-backup-20261125T053301123Z'
    getAutoBackup.mockResolvedValue({
      ...idle(),
      copies: [{ id, createdAt: Date.UTC(2026, 10, 25, 5, 33), bytes: 1536 }]
    })
    render(<AutoBackupCard />)
    await waitFor(() => expect(getAutoBackup).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: msg('settings.autoBackup.restoreButton') }))
    fireEvent.click(screen.getByRole('button', { name: msg('settings.autoBackup.list.restore') }))
    expect(screen.getByText(msg('settings.autoBackup.list.ask')).textContent).toBe(
      msg('settings.autoBackup.list.ask')
    )
    fireEvent.click(screen.getByRole('button', { name: msg('settings.autoBackup.list.cancel') }))
    expect(restoreAutoBackup).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: msg('settings.autoBackup.list.restore') }))
    fireEvent.click(screen.getByRole('button', { name: msg('settings.autoBackup.list.confirm') }))
    await waitFor(() => expect(restoreAutoBackup).toHaveBeenCalledTimes(1))
    expect(restoreAutoBackup).toHaveBeenCalledWith({ id })
    expect(restoreAutoBackup.mock.calls[0]?.[0]).toEqual({ id })
  })
})
