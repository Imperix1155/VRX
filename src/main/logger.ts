/**
 * VRX structured logging (VRX-15)
 *
 * Thin wrapper over electron-log: a file transport under `<appData>/VRX/logs`,
 * a console transport in dev, and a redaction hook so credentials/tokens never
 * reach disk. Main-process only (imports `electron`) — do NOT import from the
 * renderer/shared layers.
 *
 * Deferred (tracked separately, intentionally NOT built here):
 * - Log level from the settings store → VRX-23 (no settings system exists yet;
 *   `VRX_LOG_LEVEL` env var is the interim override).
 * - Surfacing the log path in a diagnostics panel → VRX-81 (use `getLogFilePath()`).
 */
import log from 'electron-log/main'
import { app } from 'electron'
import { join } from 'path'
import { redact } from './redact'

type LogLevel = 'error' | 'warn' | 'info' | 'verbose' | 'debug' | 'silly'
const LEVELS: readonly LogLevel[] = ['error', 'warn', 'info', 'verbose', 'debug', 'silly']

function resolveLevel(): LogLevel {
  const env = process.env.VRX_LOG_LEVEL?.toLowerCase() as LogLevel | undefined
  return env && LEVELS.includes(env) ? env : 'info'
}

let logFilePath = ''

/** Configure electron-log. Call once, inside `app.whenReady()`. */
export function initLogger(): void {
  log.initialize() // enable logging from the renderer + preload via the main bridge

  // Path BEFORE getFile() so the resolver takes effect. appData = %APPDATA% (Win),
  // ~/.config (Linux), ~/Library/Application Support (macOS).
  log.transports.file.resolvePathFn = (): string =>
    join(app.getPath('appData'), 'VRX', 'logs', 'main.log')

  log.transports.file.level = resolveLevel()
  log.transports.console.level = app.isPackaged ? 'info' : 'debug'

  // Redact every argument before it is written to any transport.
  log.hooks.push((message) => {
    message.data = message.data.map((d) => redact(d))
    return message
  })

  logFilePath = log.transports.file.getFile().path
  log.info(`VRX logger ready — level=${log.transports.file.level}, file=${logFilePath}`)
}

/** Absolute path to the active main-process log file (consumed by diagnostics — VRX-81). */
export function getLogFilePath(): string {
  return logFilePath
}

export default log
