import { app, safeStorage } from 'electron'
import { basename, join, parse, resolve } from 'node:path'
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
  writeSync
} from 'node:fs'
import {
  ProbeAssertionError,
  assertProbe,
  parseProbeArguments,
  type ProbeMode
} from './credential-persistence-probe-arguments'

const FIXTURE = 'vrx-ci-fixture-not-a-token'
const USER_DATA_BASENAME_PREFIX = 'vrx-credential-probe.'
const MARKER_NAME = '.vrx-credential-persistence-probe'
const MARKER_CONTENT = 'vrx-credential-persistence-probe-v1\n'

function requireOrdinaryProbeRoot(userDataRoot: string): string {
  try {
    const resolvedRoot = resolve(userDataRoot)
    const rootStats = lstatSync(resolvedRoot)
    assertProbe(resolvedRoot !== parse(resolvedRoot).root, 'ASSERT_USER_DATA_ROOT')
    assertProbe(
      basename(resolvedRoot).startsWith(USER_DATA_BASENAME_PREFIX),
      'ASSERT_USER_DATA_ROOT'
    )
    assertProbe(rootStats.isDirectory() && !rootStats.isSymbolicLink(), 'ASSERT_USER_DATA_ROOT')
    assertProbe(realpathSync.native(resolvedRoot) === resolvedRoot, 'ASSERT_USER_DATA_ROOT')
    return resolvedRoot
  } catch (error) {
    if (error instanceof ProbeAssertionError) throw error
    throw new ProbeAssertionError('ASSERT_USER_DATA_ROOT')
  }
}

function prepareProbeRoot(mode: ProbeMode, userDataRoot: string): string {
  const resolvedRoot = requireOrdinaryProbeRoot(userDataRoot)
  const markerPath = join(resolvedRoot, MARKER_NAME)

  if (mode === 'write') {
    try {
      assertProbe(readdirSync(resolvedRoot).length === 0, 'ASSERT_USER_DATA_ROOT')
      writeFileSync(markerPath, MARKER_CONTENT, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    } catch (error) {
      if (error instanceof ProbeAssertionError) throw error
      throw new ProbeAssertionError('ASSERT_PROBE_MARKER')
    }
    return resolvedRoot
  }

  try {
    const markerStats = lstatSync(markerPath)
    assertProbe(markerStats.isFile() && !markerStats.isSymbolicLink(), 'ASSERT_PROBE_MARKER')
    assertProbe(readFileSync(markerPath, 'utf8') === MARKER_CONTENT, 'ASSERT_PROBE_MARKER')
  } catch (error) {
    if (error instanceof ProbeAssertionError) throw error
    throw new ProbeAssertionError('ASSERT_PROBE_MARKER')
  }

  return resolvedRoot
}

function containsFixture(root: string): boolean {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name)
    if (entry.isDirectory()) {
      if (containsFixture(entryPath)) return true
    } else if (entry.isFile() && readFileSync(entryPath).includes(FIXTURE)) {
      return true
    }
  }

  return false
}

async function run(): Promise<void> {
  const { mode, userDataRoot: suppliedRoot } = parseProbeArguments(process.argv)
  const userDataRoot = prepareProbeRoot(mode, suppliedRoot)
  assertProbe(process.platform === 'linux', 'ASSERT_LINUX_PLATFORM')

  try {
    app.setPath('userData', userDataRoot)
  } catch {
    throw new ProbeAssertionError('ASSERT_USER_DATA_ROOT')
  }

  await app.whenReady()

  // Import after setPath so production electron-store instances can only use
  // the caller's disposable userData directory.
  const { CREDENTIAL_KEYS, clearCredential, loadCredential, saveCredential } =
    await import('../src/main/services/credentials')

  const local = process.env.VRX_CREDENTIAL_PROBE_STORAGE === 'local'
  if (local) {
    assertProbe(safeStorage.getSelectedStorageBackend() === 'basic_text', 'ASSERT_LOCAL_BACKEND')
  } else {
    assertProbe(safeStorage.isEncryptionAvailable(), 'ASSERT_ENCRYPTION_AVAILABLE')
    assertProbe(
      safeStorage.getSelectedStorageBackend() === 'gnome_libsecret',
      'ASSERT_SECURE_BACKEND'
    )
  }

  if (mode === 'write') {
    try {
      saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, FIXTURE)
      saveCredential(CREDENTIAL_KEYS.CHILLOUTVR_PRIMARY, FIXTURE)
      const stored = JSON.parse(
        readFileSync(join(userDataRoot, 'credentials.json'), 'utf8')
      ) as Record<string, unknown>
      for (const key of Object.values(CREDENTIAL_KEYS)) {
        const value = stored[key]
        assertProbe(typeof value === 'string', 'ASSERT_CREDENTIAL_SAVE')
        assertProbe(
          local ? value.startsWith('!vrx-local-v1!') : !value.startsWith('!'),
          local ? 'ASSERT_LOCAL_RECORD' : 'ASSERT_SECURE_RECORD'
        )
      }
    } catch (error) {
      if (error instanceof ProbeAssertionError) throw error
      throw new ProbeAssertionError('ASSERT_CREDENTIAL_SAVE')
    }

    try {
      assertProbe(!containsFixture(userDataRoot), 'ASSERT_PLAINTEXT_ABSENT')
    } catch (error) {
      if (error instanceof ProbeAssertionError) throw error
      throw new ProbeAssertionError('ASSERT_PLAINTEXT_ABSENT')
    }
    return
  }

  try {
    assertProbe(
      Object.values(CREDENTIAL_KEYS).every((key) => loadCredential(key) === FIXTURE),
      'ASSERT_CREDENTIAL_READ'
    )
  } catch (error) {
    if (error instanceof ProbeAssertionError) throw error
    throw new ProbeAssertionError('ASSERT_CREDENTIAL_READ')
  }

  try {
    for (const key of Object.values(CREDENTIAL_KEYS)) clearCredential(key)
    assertProbe(
      Object.values(CREDENTIAL_KEYS).every((key) => loadCredential(key) === undefined),
      'ASSERT_CREDENTIAL_CLEAR'
    )
  } catch (error) {
    if (error instanceof ProbeAssertionError) throw error
    throw new ProbeAssertionError('ASSERT_CREDENTIAL_CLEAR')
  }
}

void run().then(
  () => app.exit(0),
  (error: unknown) => {
    const label =
      error instanceof ProbeAssertionError ? error.label : ('ASSERT_PROBE_EXECUTION' as const)
    writeSync(2, `${label}\n`)
    app.exit(1)
  }
)
