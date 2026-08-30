import { isAbsolute } from 'node:path'

export type ProbeMode = 'write' | 'read'
export type AssertionLabel =
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

export class ProbeAssertionError extends Error {
  constructor(readonly label: AssertionLabel) {
    super(label)
  }
}

export function assertProbe(condition: boolean, label: AssertionLabel): asserts condition {
  if (!condition) throw new ProbeAssertionError(label)
}

export function parseProbeArguments(argv: readonly string[]): {
  mode: ProbeMode
  userDataRoot: string
} {
  const args = argv.slice(-2)
  assertProbe(args.length === 2, 'ASSERT_ARGUMENTS')

  const [mode, userDataRoot] = args
  assertProbe(mode === 'write' || mode === 'read', 'ASSERT_ARGUMENTS')
  assertProbe(typeof userDataRoot === 'string' && isAbsolute(userDataRoot), 'ASSERT_USER_DATA_ROOT')

  return { mode, userDataRoot }
}
