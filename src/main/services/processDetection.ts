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

function firstCommandExecutable(command: string): string | null {
  const match = command.match(/^\s*(?:"([^"]*)"|'([^']*)'|(\S+))/)
  const value = match?.[1] ?? match?.[2] ?? match?.[3]
  return value ? executableName(value) : null
}

function firstWineTargetExecutable(command: string): string | null {
  const match = command.match(/(?:^|[\\/\s"'])([^\\/\s"']+\.exe)(?=["'\s]|$)/i)
  return match?.[1]?.toLowerCase() ?? null
}

function commandExecutableNames(command: string, wineHost: boolean): string[] {
  const first = firstCommandExecutable(command)
  if (!first) return []

  if (!wineHost && !WINE_LAUNCHERS.has(first)) return [first]

  const target = firstWineTargetExecutable(command)
  return target ? [first, target] : [first]
}

function processExecutableNames(process: ProcessDescriptor): string[] {
  const hostNames = [
    executableName(process.name),
    ...(process.path ? [executableName(process.path)] : [])
  ]
  const wineHost = hostNames.some((name) => WINE_LAUNCHERS.has(name))
  return [...hostNames, ...(process.cmd ? commandExecutableNames(process.cmd, wineHost) : [])]
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
