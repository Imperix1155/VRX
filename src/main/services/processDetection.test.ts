import { beforeEach, describe, expect, it, vi } from 'vitest'
import { detectVrProcesses, getRunningVrProcesses } from './processDetection'

const { psList } = vi.hoisted(() => ({ psList: vi.fn() }))

vi.mock('ps-list', () => ({ default: psList }))

beforeEach(() => {
  psList.mockReset()
})

describe('detectVrProcesses', () => {
  it('detects Windows executables by exact process name', () => {
    expect(
      detectVrProcesses([
        { pid: 101, name: 'VRChat.exe', ppid: 1 },
        { pid: 102, name: 'ChilloutVR.exe', ppid: 1 },
        { pid: 103, name: 'vrserver.exe', ppid: 1 }
      ])
    ).toEqual({ vrchat: true, chilloutvr: true, steamvr: true })
  })

  it('detects native Linux-style process names', () => {
    expect(
      detectVrProcesses([
        { pid: 201, name: 'VRChat', ppid: 1 },
        { pid: 202, name: 'ChilloutVR', ppid: 1 },
        { pid: 203, name: 'vrserver', ppid: 1 }
      ])
    ).toEqual({ vrchat: true, chilloutvr: true, steamvr: true })
  })

  it('detects Proton and Wine executables from command lines and paths', () => {
    expect(
      detectVrProcesses([
        {
          pid: 301,
          name: 'wine64-preloader',
          ppid: 1,
          cmd: 'wine64-preloader /compatdata/438100/pfx/drive_c/VRChat/VRChat.exe --no-vr'
        },
        {
          pid: 302,
          name: 'wine',
          ppid: 1,
          path: '/compatdata/661130/pfx/drive_c/ChilloutVR/ChilloutVR.exe'
        }
      ])
    ).toEqual({ vrchat: true, chilloutvr: true, steamvr: false })
  })

  it('detects a Wine target under an unquoted Steam library path with spaces', () => {
    expect(
      detectVrProcesses([
        {
          pid: 303,
          name: 'wine64-preloader',
          ppid: 1,
          path: '/usr/lib/wine/wine64-preloader',
          cmd: 'wine64-preloader /mnt/VR Games/SteamLibrary/steamapps/common/VRChat/VRChat.exe --no-vr'
        }
      ])
    ).toEqual({ vrchat: true, chilloutvr: false, steamvr: false })
  })

  it('does not treat partial executable-name matches as running apps', () => {
    expect(
      detectVrProcesses([
        { pid: 401, name: 'NotVRChat.exe', ppid: 1 },
        { pid: 402, name: 'ChilloutVR.exe.old', ppid: 1 },
        { pid: 403, name: 'vrserver-helper', ppid: 1 },
        {
          pid: 404,
          name: 'diagnostics',
          ppid: 1,
          cmd: 'diagnostics /tmp/VRChat.exe'
        },
        {
          pid: 405,
          name: 'wine64-preloader',
          ppid: 1,
          cmd: 'wine64-preloader /compatdata/438100/pfx/drive_c/VRChat/crashhandler.exe --label /tmp/VRChat.exe'
        },
        {
          pid: 406,
          name: 'backup',
          ppid: 1,
          cmd: 'backup /tmp/VRChat.exe/config.json'
        }
      ])
    ).toEqual({ vrchat: false, chilloutvr: false, steamvr: false })
  })
})

describe('getRunningVrProcesses', () => {
  it('enumerates only the current user through ps-list by default', async () => {
    psList.mockResolvedValue([{ pid: 500, name: 'VRChat.exe', ppid: 1 }])

    await expect(getRunningVrProcesses()).resolves.toEqual({
      vrchat: true,
      chilloutvr: false,
      steamvr: false
    })
    expect(psList).toHaveBeenCalledOnce()
    expect(psList).toHaveBeenCalledWith({ all: false })
  })

  it('enumerates processes once and returns the detected applications', async () => {
    const listProcesses = vi.fn().mockResolvedValue([
      { pid: 501, name: 'VRChat.exe', ppid: 1 },
      { pid: 502, name: 'unrelated', ppid: 1 }
    ])

    await expect(getRunningVrProcesses(listProcesses)).resolves.toEqual({
      vrchat: true,
      chilloutvr: false,
      steamvr: false
    })
    expect(listProcesses).toHaveBeenCalledOnce()
  })
})
