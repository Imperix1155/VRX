import type { ProcessDescriptor } from 'ps-list'

export interface RunningVrProcesses {
  vrchat: boolean
  chilloutvr: boolean
  steamvr: boolean
}

type ProcessLister = () => Promise<readonly ProcessDescriptor[]>

async function listCurrentUserProcesses(): Promise<ProcessDescriptor[]> {
  const { default: listProcesses } = await import('ps-list')
  return listProcesses({ all: false })
}

const EXECUTABLES = {
  vrchat: ['VRChat', 'VRChat.exe'],
  chilloutvr: ['ChilloutVR', 'ChilloutVR.exe'],
  steamvr: ['vrserver', 'vrserver.exe']
} as const satisfies Record<keyof RunningVrProcesses, readonly string[]>

const WINE_LAUNCHERS = new Set(['wine', 'wine64', 'wine-preloader', 'wine64-preloader'])

function executableName(value: string): string {
  return (value.split(/[\\/]/).at(-1) ?? value).toLowerCase()
}

function commandTokens(command: string): string[] {
  return (command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((token) => {
    const quote = token[0]
    return (quote === '"' || quote === "'") && token.at(-1) === quote ? token.slice(1, -1) : token
  })
}

function commandExecutableNames(command: string): string[] {
  const tokens = commandTokens(command)
  if (!tokens[0]) return []

  const first = executableName(tokens[0])
  if (!WINE_LAUNCHERS.has(first)) return [first]

  const targetIndex = tokens[1] === '--' ? 2 : 1
  return tokens[targetIndex] ? [first, executableName(tokens[targetIndex])] : [first]
}

function processExecutableNames(process: ProcessDescriptor): string[] {
  return [
    executableName(process.name),
    ...(process.path ? [executableName(process.path)] : []),
    ...(process.cmd ? commandExecutableNames(process.cmd) : [])
  ]
}

/** Classify a process snapshot without performing I/O. */
export function detectVrProcesses(processes: readonly ProcessDescriptor[]): RunningVrProcesses {
  const runningExecutables = new Set(processes.flatMap(processExecutableNames))

  return {
    vrchat: EXECUTABLES.vrchat.some((executable) =>
      runningExecutables.has(executable.toLowerCase())
    ),
    chilloutvr: EXECUTABLES.chilloutvr.some((executable) =>
      runningExecutables.has(executable.toLowerCase())
    ),
    steamvr: EXECUTABLES.steamvr.some((executable) =>
      runningExecutables.has(executable.toLowerCase())
    )
  }
}

/** Enumerate the host once and report which supported VR applications are running. */
export async function getRunningVrProcesses(
  listProcesses: ProcessLister = listCurrentUserProcesses
): Promise<RunningVrProcesses> {
  return detectVrProcesses(await listProcesses())
}
