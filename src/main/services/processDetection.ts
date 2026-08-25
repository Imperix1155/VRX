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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function commandContainsExecutable(command: string, executable: string): boolean {
  const boundary = `[\\s"'\\\\/]`
  return new RegExp(`(?:^|${boundary})${escapeRegex(executable)}(?=$|${boundary})`, 'i').test(
    command
  )
}

function processMatchesExecutable(process: ProcessDescriptor, executable: string): boolean {
  if (process.name.toLowerCase() === executable.toLowerCase()) {
    return true
  }

  const pathName = process.path?.split(/[\\/]/).at(-1)
  if (pathName?.toLowerCase() === executable.toLowerCase()) {
    return true
  }

  return process.cmd ? commandContainsExecutable(process.cmd, executable) : false
}

/** Classify a process snapshot without performing I/O. */
export function detectVrProcesses(processes: readonly ProcessDescriptor[]): RunningVrProcesses {
  return {
    vrchat: processes.some((process) =>
      EXECUTABLES.vrchat.some((executable) => processMatchesExecutable(process, executable))
    ),
    chilloutvr: processes.some((process) =>
      EXECUTABLES.chilloutvr.some((executable) => processMatchesExecutable(process, executable))
    ),
    steamvr: processes.some((process) =>
      EXECUTABLES.steamvr.some((executable) => processMatchesExecutable(process, executable))
    )
  }
}

/** Enumerate the host once and report which supported VR applications are running. */
export async function getRunningVrProcesses(
  listProcesses: ProcessLister = listCurrentUserProcesses
): Promise<RunningVrProcesses> {
  return detectVrProcesses(await listProcesses())
}
