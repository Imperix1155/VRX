import { app, safeStorage } from 'electron'
import { basename, isAbsolute, join, parse, resolve } from 'node:path'
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'

const FIXTURE = 'vrx-ci-fixture-not-a-token'
const USER_DATA_BASENAME_PREFIX = 'vrx-credential-probe.'
const MARKER_NAME = '.vrx-credential-persistence-probe'
const MARKER_CONTENT = 'vrx-credential-persistence-probe-v1\n'

type ProbeMode = 'write' | 'read'
type AssertionLabel =
  | 'ASSERT_ARGUMENTS'
  | 'ASSERT_LINUX_PLATFORM'
  | 'ASSERT_USER_DATA_ROOT'
  | 'ASSERT_PROBE_MARKER'
  | 'ASSERT_ENCRYPTION_AVAILABLE'
  | 'ASSERT_SECURE_BACKEND'
  | 'ASSERT_CREDENTIAL_SAVE'
  | 'ASSERT_PLAINTEXT_ABSENT'
  | 'ASSERT_CREDENTIAL_READ'
  | 'ASSERT_CREDENTIAL_CLEAR'
  | 'ASSERT_PROBE_EXECUTION'

class ProbeAssertionError extends Error {
  constructor(readonly label: AssertionLabel) {
    super(label)
  }
}

function assertProbe(condition: boolean, label: AssertionLabel): asserts condition {
  if (!condition) throw new ProbeAssertionError(label)
}

function parseArguments(): { mode: ProbeMode; userDataRoot: string } {
  const args = process.argv.slice(2)
  assertProbe(args.length === 2, 'ASSERT_ARGUMENTS')

  const [mode, userDataRoot] = args
  assertProbe(mode === 'write' || mode === 'read', 'ASSERT_ARGUMENTS')
  assertProbe(typeof userDataRoot === 'string' && isAbsolute(userDataRoot), 'ASSERT_USER_DATA_ROOT')

  return { mode, userDataRoot }
}

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
  const { mode, userDataRoot: suppliedRoot } = parseArguments()
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

  assertProbe(safeStorage.isEncryptionAvailable(), 'ASSERT_ENCRYPTION_AVAILABLE')
  assertProbe(
    safeStorage.getSelectedStorageBackend() === 'gnome_libsecret',
    'ASSERT_SECURE_BACKEND'
  )

  if (mode === 'write') {
    try {
      saveCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY, FIXTURE)
    } catch {
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
      loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY) === FIXTURE,
      'ASSERT_CREDENTIAL_READ'
    )
  } catch (error) {
    if (error instanceof ProbeAssertionError) throw error
    throw new ProbeAssertionError('ASSERT_CREDENTIAL_READ')
  }

  try {
    clearCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY)
    assertProbe(
      loadCredential(CREDENTIAL_KEYS.VRCHAT_PRIMARY) === undefined,
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
    process.stderr.write(`${label}\n`)
    app.exit(1)
  }
)
