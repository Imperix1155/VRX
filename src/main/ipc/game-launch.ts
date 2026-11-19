import { ipcMain } from 'electron'
import type { IpcInvoke } from '@shared/ipc'
import type { Platform } from '@shared/types'
import type { GameLauncher } from '../services/gameLauncher'
import { isTrustedIpcSender } from './security'

const VALID_PLATFORMS = new Set<unknown>(['vrchat', 'chilloutvr'] satisfies Platform[])

type GameLaunchLog = (message: string, meta: { platform: Platform; reason: string }) => void

/**
 * Quick launch: start a game without joining anyone. The request names a
 * platform and nothing else; main owns the link and whether to open it.
 */
export function registerGameLaunchHandlers(
  launcher: Pick<GameLauncher, 'start'>,
  log: GameLaunchLog = () => undefined
): void {
  ipcMain.handle(
    'launch-game',
    async (
      event,
      req: IpcInvoke['launch-game']['req']
    ): Promise<IpcInvoke['launch-game']['res']> => {
      if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
      if (typeof req !== 'object' || req === null || !VALID_PLATFORMS.has(req.platform)) {
        throw new Error('Invalid launch-game request')
      }
      const result = await launcher.start(req.platform)
      if (!result.ok) log('game launch denied', { platform: req.platform, reason: result.reason })
      return result
    }
  )
}
