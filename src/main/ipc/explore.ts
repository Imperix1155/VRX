import { ipcMain } from 'electron'
import { z } from 'zod'
import type { IpcInvoke } from '@shared/ipc'
import type { ExploreService } from '../services/exploreService'
import { isTrustedIpcSender } from './security'

const platform = z.enum(['vrchat', 'chilloutvr'])
const reference = z.string().min(1).max(128)
const platformRequest = z
  .object({ platform, reason: z.enum(['snapshot', 'automatic', 'manual']) })
  .strict()
const worldRequest = z
  .object({ platform, worldRef: reference, reason: z.enum(['snapshot', 'open', 'manual']) })
  .strict()
const worldReference = z.object({ platform, worldRef: reference }).strict()
const activeRequest = z.object({ platforms: z.array(platform).max(2) }).strict()
const joinRequest = z
  .object({ platform, selectionRef: reference, mode: z.enum(['desktop', 'vr']) })
  .strict()

/** Renderer provides opaque selections. Main retains all upstream identifiers and authority. */
export function registerExploreHandlers(service: ExploreService): void {
  ipcMain.handle('set-explore-active', (event, req: IpcInvoke['set-explore-active']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = activeRequest.parse(req)
    service.setActive([...new Set(parsed.platforms)])
  })
  ipcMain.handle('get-explore', (event, req: IpcInvoke['get-explore']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = platformRequest.parse(req)
    return service.getSnapshot(parsed.platform, parsed.reason)
  })
  ipcMain.handle('get-explore-world', (event, req: IpcInvoke['get-explore-world']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = worldRequest.parse(req)
    return service.getWorld(parsed.platform, parsed.worldRef, parsed.reason)
  })
  ipcMain.handle('cancel-explore-world', (event, req: IpcInvoke['cancel-explore-world']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = worldReference.parse(req)
    service.cancelWorld(parsed.platform, parsed.worldRef)
  })
  ipcMain.handle('get-explore-image', (event, req: IpcInvoke['get-explore-image']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = worldReference.parse(req)
    return service.getImage(parsed.platform, parsed.worldRef)
  })
  ipcMain.handle('join-explore-room', (event, req: IpcInvoke['join-explore-room']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = joinRequest.parse(req)
    return service.joinRoom(parsed.platform, parsed.selectionRef, parsed.mode)
  })
}
