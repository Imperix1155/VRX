import type { BigIntStats, Dir } from 'node:fs'
import { lstat, open, opendir, type FileHandle } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, win32 as win32Path } from 'node:path'
import { SaxesParser } from 'saxes'
import type { CVRCredentials } from './adapters/CvrApiClient'
import { isValidCvrSession } from './adapters/credentialValidation'

const MAX_JSON_BYTES = 1_048_576
const MAX_PROFILE_BYTES = 131_072
const MAX_STEAM_METADATA_BYTES = 1_048_576
const MAX_DIRECTORY_ENTRIES = 512
const MAX_CREDENTIAL_RECORDS = 128
const MAX_GAME_DATA_PATHS = 16
const MAX_PROFILE_FILES = 32
const FILE_IO_TIMEOUT_MS = 750
const IMPORT_TIMEOUT_MS = 1_000

export interface CvrSessionImportPaths {
  appDataPath: string
  homePath: string
  platform: NodeJS.Platform
  environment: Readonly<Record<string, string | undefined>>
}

interface CvrxConfig {
  activeUsername: string | null
  executablePath: string | null
}

interface LoadStoredOrImportedOptions {
  loadStored: () => CVRCredentials | undefined
  importSession: () => Promise<CVRCredentials | null>
  persistImported: (credentials: CVRCredentials) => void
}

interface ImportContext {
  controller: AbortController
  deadline: number
  remainingProfiles: number
  sourceAInvalid: boolean
}

const settleWithin = <T>(
  operation: Promise<T>,
  context: ImportContext,
  disposeLateValue?: (value: T) => void,
  onTimeout?: () => void,
  onRejected?: () => void
): Promise<T | null> =>
  new Promise((resolve) => {
    let settled = false
    const remaining = Math.max(0, context.deadline - Date.now())
    if (remaining === 0 || context.controller.signal.aborted) {
      onTimeout?.()
      operation.then(disposeLateValue, () => undefined)
      resolve(null)
      return
    }
    const timer = setTimeout(
      () => {
        settled = true
        onTimeout?.()
        resolve(null)
      },
      Math.min(FILE_IO_TIMEOUT_MS, remaining)
    )
    timer.unref()
    operation.then(
      (value) => {
        if (settled) {
          disposeLateValue?.(value)
          return
        }
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        onRejected?.()
        resolve(null)
      }
    )
  })

const closeHandle = (handle: FileHandle): void => {
  void handle.close().catch(() => undefined)
}

const closeDirectory = (directory: Dir): void => {
  void directory.close().catch(() => undefined)
}

const sameFile = (
  left: Awaited<ReturnType<typeof lstat>>,
  right: Awaited<ReturnType<FileHandle['stat']>>
): boolean => left.dev === right.dev && left.ino === right.ino

const sameDirectory = (left: BigIntStats, right: BigIntStats): boolean =>
  left.dev === right.dev && left.ino === right.ino && left.ctimeNs === right.ctimeNs

const readBoundedFile = async (
  path: string,
  maxBytes: number,
  context: ImportContext,
  onTimeout?: () => void,
  onRejected?: () => void
): Promise<string | null> => {
  if (context.controller.signal.aborted || Date.now() >= context.deadline) {
    onTimeout?.()
    return null
  }
  const pathStat = await settleWithin(lstat(path), context, undefined, onTimeout, onRejected)
  if (
    pathStat === null ||
    !pathStat.isFile() ||
    pathStat.isSymbolicLink() ||
    pathStat.size > maxBytes
  ) {
    return null
  }
  const handle = await settleWithin(open(path, 'r'), context, closeHandle, onTimeout, onRejected)
  if (handle === null) return null
  try {
    const handleStat = await settleWithin(handle.stat(), context, undefined, onTimeout, onRejected)
    if (handleStat === null) return null
    if (!handleStat.isFile() || handleStat.size > maxBytes || !sameFile(pathStat, handleStat)) {
      onRejected?.()
      return null
    }
    const buffer = Buffer.alloc(maxBytes + 1)
    let bytesRead = 0
    while (bytesRead < buffer.length) {
      const result = await settleWithin(
        handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead),
        context,
        undefined,
        onTimeout,
        onRejected
      )
      if (result === null) return null
      if (result.bytesRead === 0) break
      bytesRead += result.bytesRead
    }
    if (bytesRead > maxBytes) return null
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    closeHandle(handle)
  }
}

const parseJsonObject = async (
  path: string,
  context: ImportContext
): Promise<Record<string, unknown> | null> => {
  const contents = await readBoundedFile(path, MAX_JSON_BYTES, context)
  if (contents === null) return null
  try {
    const parsed: unknown = JSON.parse(contents)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

const parseCvrxConfig = async (path: string, context: ImportContext): Promise<CvrxConfig> => {
  const parsed = await parseJsonObject(path, context)
  if (parsed?.['FileVersion'] !== 1) return { activeUsername: null, executablePath: null }
  const data = parsed['data']
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { activeUsername: null, executablePath: null }
  }
  const record = data as Record<string, unknown>
  return {
    activeUsername: typeof record['ActiveUsername'] === 'string' ? record['ActiveUsername'] : null,
    executablePath: typeof record['CVRExecutable'] === 'string' ? record['CVRExecutable'] : null
  }
}

const parseLoginProfile = (contents: string): CVRCredentials | null => {
  let invalid = false
  let depth = 0
  let rootSeen = false
  let capture: 'Username' | 'AccessKey' | null = null
  let captureDepth = 0
  let captureText = ''
  let username: string | null = null
  let accessKey: string | null = null
  const parser = new SaxesParser({ xmlns: false })

  parser.on('doctype', () => {
    invalid = true
  })
  parser.on('cdata', () => {
    invalid = true
  })
  parser.on('processinginstruction', () => {
    invalid = true
  })
  parser.on('opentag', (tag) => {
    depth += 1
    if (depth === 1) {
      rootSeen = tag.name === 'LoginProfile'
      if (!rootSeen) invalid = true
      return
    }
    if (capture !== null) {
      invalid = true
      return
    }
    if (depth !== 2 || (tag.name !== 'Username' && tag.name !== 'AccessKey')) return
    if (
      (tag.name === 'Username' && username !== null) ||
      (tag.name === 'AccessKey' && accessKey !== null)
    ) {
      invalid = true
      return
    }
    capture = tag.name
    captureDepth = depth
    captureText = ''
  })
  parser.on('text', (text) => {
    if (capture !== null) captureText += text
    else if (depth === 0 && text.trim() !== '') invalid = true
  })
  parser.on('closetag', () => {
    if (capture !== null && depth === captureDepth) {
      if (capture === 'Username') username = captureText
      else accessKey = captureText
      capture = null
    }
    depth -= 1
  })
  parser.on('error', () => {
    invalid = true
  })

  try {
    parser.write(contents).close()
  } catch {
    invalid = true
  }
  if (
    invalid ||
    !rootSeen ||
    depth !== 0 ||
    capture !== null ||
    username === null ||
    accessKey === null ||
    !isValidCvrSession(username, accessKey)
  ) {
    return null
  }
  return { username, accessKey }
}

const isLocalAbsolutePath = (path: string, platform: NodeJS.Platform): boolean => {
  if (platform !== 'win32') return isAbsolute(path)
  const normalized = path.replaceAll('/', '\\')
  if (normalized.startsWith('\\\\')) return false
  return isAbsolute(path) || win32Path.isAbsolute(normalized)
}

const configuredGameDataPath = (
  executablePath: string | null,
  platform: NodeJS.Platform
): string | null => {
  if (executablePath === null || !isLocalAbsolutePath(executablePath, platform)) return null
  const executableName = basename(executablePath).toLowerCase()
  if (executableName !== 'chilloutvr.exe' && executableName !== 'chilloutvr') return null
  return join(dirname(executablePath), 'ChilloutVR_Data')
}

const steamRoots = (paths: CvrSessionImportPaths): string[] => {
  switch (paths.platform) {
    case 'darwin':
      return [join(paths.appDataPath, 'Steam')]
    case 'linux':
      return [
        join(paths.homePath, '.local', 'share', 'Steam'),
        join(paths.homePath, '.steam', 'steam')
      ]
    case 'win32': {
      const candidates = [
        paths.environment['ProgramFiles(x86)'],
        paths.environment['PROGRAMFILES(X86)'],
        paths.environment['ProgramFiles'],
        paths.environment['PROGRAMFILES']
      ]
      return candidates
        .filter(
          (candidate): candidate is string =>
            candidate !== undefined &&
            candidate !== '' &&
            isLocalAbsolutePath(candidate, paths.platform)
        )
        .map((candidate) => join(candidate, 'Steam'))
    }
    default:
      return []
  }
}

const decodeSteamPath = (rawPath: string): string | null => {
  let decoded = ''
  for (let index = 0; index < rawPath.length; index += 1) {
    const character = rawPath[index]
    if (character !== '\\') {
      decoded += character
      continue
    }
    const escaped = rawPath[index + 1]
    if (escaped !== '\\' && escaped !== '/') return null
    decoded += escaped
    index += 1
  }
  return decoded
}

const parseSteamLibraryPaths = async (
  steamRoot: string,
  paths: CvrSessionImportPaths,
  context: ImportContext
): Promise<string[] | null> => {
  const contents = await readBoundedFile(
    join(steamRoot, 'steamapps', 'libraryfolders.vdf'),
    MAX_STEAM_METADATA_BYTES,
    context,
    () => {
      context.sourceAInvalid = true
    }
  )
  if (contents === null) return []
  const libraries: string[] = []
  const pathExpression = /"path"\s+"((?:\\.|[^"\\])*)"/g
  for (const match of contents.matchAll(pathExpression)) {
    const rawPath = match[1]
    if (rawPath === undefined) continue
    const decodedPath = decodeSteamPath(rawPath)
    if (
      decodedPath === null ||
      decodedPath.includes('\0') ||
      !isLocalAbsolutePath(decodedPath, paths.platform)
    ) {
      continue
    }
    if (libraries.length >= MAX_GAME_DATA_PATHS) return null
    libraries.push(decodedPath)
  }
  return libraries
}

const steamGameDataPaths = async (
  paths: CvrSessionImportPaths,
  context: ImportContext
): Promise<string[] | null> => {
  const candidates = new Set<string>()
  const roots = steamRoots(paths)
  for (const steamRoot of roots) {
    if (context.controller.signal.aborted) {
      context.sourceAInvalid = true
      return []
    }
    const discoveredLibraries = await parseSteamLibraryPaths(steamRoot, paths, context)
    if (discoveredLibraries === null) return null
    const libraries = [steamRoot, ...discoveredLibraries]
    for (const library of libraries) {
      candidates.add(join(library, 'steamapps', 'common', 'ChilloutVR', 'ChilloutVR_Data'))
      if (candidates.size > MAX_GAME_DATA_PATHS) return null
    }
  }
  return [...candidates]
}

const profileCredentials = async (
  directory: string,
  context: ImportContext
): Promise<CVRCredentials[] | null> => {
  const invalidateSource = (): void => {
    context.sourceAInvalid = true
  }
  if (context.controller.signal.aborted) {
    invalidateSource()
    return []
  }
  const stat = await settleWithin(
    lstat(directory, { bigint: true }),
    context,
    undefined,
    invalidateSource
  )
  if (stat === null || !stat.isDirectory() || stat.isSymbolicLink()) return []
  const directoryIsUnchanged = async (): Promise<boolean> => {
    const current = await settleWithin(
      lstat(directory, { bigint: true }),
      context,
      undefined,
      invalidateSource,
      invalidateSource
    )
    const unchanged =
      current !== null &&
      current.isDirectory() &&
      !current.isSymbolicLink() &&
      sameDirectory(stat, current)
    if (!unchanged) invalidateSource()
    return unchanged
  }
  const directoryHandle = await settleWithin(
    opendir(directory),
    context,
    closeDirectory,
    invalidateSource,
    invalidateSource
  )
  if (directoryHandle === null) return []
  try {
    const profileNames: string[] = []
    let entriesRead = 0
    while (true) {
      const entry = await settleWithin(
        directoryHandle.read(),
        context,
        undefined,
        invalidateSource,
        invalidateSource
      )
      if (entry === null) break
      entriesRead += 1
      if (entriesRead > MAX_DIRECTORY_ENTRIES) {
        invalidateSource()
        return null
      }
      if (entry.isFile() && /^autologin[^/\\]*\.profile$/i.test(entry.name)) {
        if (context.remainingProfiles === 0) {
          context.sourceAInvalid = true
          return null
        }
        context.remainingProfiles -= 1
        profileNames.push(entry.name)
      }
    }
    const candidates: CVRCredentials[] = []
    for (const profileName of profileNames.sort((left, right) => left.localeCompare(right))) {
      if (!(await directoryIsUnchanged())) return null
      const contents = await readBoundedFile(
        join(directory, profileName),
        MAX_PROFILE_BYTES,
        context,
        invalidateSource,
        invalidateSource
      )
      if (contents === null) {
        if (context.sourceAInvalid) return null
        continue
      }
      if (!(await directoryIsUnchanged())) return null
      const credentials = parseLoginProfile(contents)
      if (credentials !== null) candidates.push(credentials)
    }
    return candidates
  } finally {
    closeDirectory(directoryHandle)
  }
}

const discoverProfileCredentials = async (
  dataPaths: Promise<string[] | null>,
  context: ImportContext,
  claimedPaths: Set<string>
): Promise<CVRCredentials[]> => {
  const discoveredPaths = await dataPaths
  if (discoveredPaths === null) {
    context.sourceAInvalid = true
    return []
  }
  const profiles: CVRCredentials[] = []
  for (const dataPath of discoveredPaths) {
    if (claimedPaths.has(dataPath)) continue
    if (claimedPaths.size >= MAX_GAME_DATA_PATHS) {
      context.sourceAInvalid = true
      return []
    }
    claimedPaths.add(dataPath)
    const discovered = await profileCredentials(dataPath, context)
    if (discovered === null) {
      context.sourceAInvalid = true
      return []
    }
    profiles.push(...discovered)
  }
  return profiles
}

const cvrxCredentials = async (path: string, context: ImportContext): Promise<CVRCredentials[]> => {
  const parsed = await parseJsonObject(path, context)
  if (parsed?.['FileVersion'] !== 1) return []
  const data = parsed['data']
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return []
  const values = Object.values(data as Record<string, unknown>)
  if (values.length > MAX_CREDENTIAL_RECORDS) return []

  return values.flatMap((value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
    const record = value as Record<string, unknown>
    const username = record['Username']
    const accessKey = record['AccessKey']
    if (
      typeof username !== 'string' ||
      typeof accessKey !== 'string' ||
      !isValidCvrSession(username, accessKey)
    ) {
      return []
    }
    return [{ username, accessKey }]
  })
}

const selectCredential = (
  credentials: CVRCredentials[],
  activeUsername: string | null
): CVRCredentials | null => {
  const eligible =
    activeUsername === null
      ? credentials
      : credentials.filter((credential) => credential.username === activeUsername)
  const unique = new Map<string, CVRCredentials>()
  for (const credential of eligible) {
    const key = `${credential.username.length}:${credential.username}${credential.accessKey}`
    unique.set(key, credential)
  }
  return unique.size === 1 ? ([...unique.values()][0] ?? null) : null
}

/**
 * Read-only CVR session discovery. Game auto-login profiles are preferred;
 * CVRX credentials are the fallback. Malformed, unsafe, absent, ambiguous, or
 * over-budget inputs and unsafe root paths are ignored before source I/O; null
 * means neither source produced one safe, unambiguous credential pair.
 */
export async function importCvrSession(
  paths: CvrSessionImportPaths
): Promise<CVRCredentials | null> {
  if (
    !isLocalAbsolutePath(paths.appDataPath, paths.platform) ||
    !isLocalAbsolutePath(paths.homePath, paths.platform)
  ) {
    return null
  }
  const controller = new AbortController()
  const context: ImportContext = {
    controller,
    deadline: Date.now() + IMPORT_TIMEOUT_MS,
    remainingProfiles: MAX_PROFILE_FILES,
    sourceAInvalid: false
  }
  const deadlineTimer = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_MS)
  deadlineTimer.unref()
  try {
    const configDirectory = join(paths.appDataPath, 'CVRX', 'CVRConfigs')
    const configPromise = parseCvrxConfig(join(configDirectory, 'config.json'), context)
    const fallbackPromise = cvrxCredentials(join(configDirectory, 'credentials.json'), context)
    const claimedPaths = new Set<string>()
    const steamProfilesPromise = discoverProfileCredentials(
      steamGameDataPaths(paths, context),
      context,
      claimedPaths
    )
    const config = await configPromise
    const configured = configuredGameDataPath(config.executablePath, paths.platform)
    const configuredProfilesPromise = discoverProfileCredentials(
      Promise.resolve(configured === null ? [] : [configured]),
      context,
      claimedPaths
    )
    const [steamProfiles, configuredProfiles, fallbackCredentials] = await Promise.all([
      steamProfilesPromise,
      configuredProfilesPromise,
      fallbackPromise
    ])
    const profiles = [...steamProfiles, ...configuredProfiles]
    const preferred = context.sourceAInvalid
      ? null
      : (selectCredential(profiles, null) ?? selectCredential(profiles, config.activeUsername))
    return preferred ?? selectCredential(fallbackCredentials, config.activeUsername)
  } finally {
    clearTimeout(deadlineTimer)
    controller.abort()
  }
}

/**
 * Preserve an existing valid VRX session. Invalid stored material is treated
 * as absent so a safe local import can replace it. A newly imported session
 * becomes usable only after the caller has persisted it through safeStorage.
 */
export async function loadStoredOrImportedCvrSession(
  options: LoadStoredOrImportedOptions
): Promise<CVRCredentials | undefined> {
  const stored = options.loadStored()
  if (stored !== undefined && isValidCvrSession(stored.username, stored.accessKey)) return stored

  const imported = await options.importSession()
  if (imported === null || !isValidCvrSession(imported.username, imported.accessKey)) {
    return undefined
  }
  const credentials = { username: imported.username, accessKey: imported.accessKey }
  options.persistImported(credentials)
  return credentials
}
