/**
 * isTrustedIpcSender tests (2026-07 audit W6 — this guard protects EVERY IPC
 * channel and had zero tests).
 *
 * `@electron-toolkit/utils` is mocked (it imports electron, unavailable in
 * vitest); the guard reads `is.dev` at CALL time, so a getter-backed mock
 * flips dev/prod per test without module resets.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebFrameMain } from 'electron'
import { isTrustedIpcSender } from './security'

const mockState = { dev: true }

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    get dev() {
      return mockState.dev
    }
  }
}))

/** Minimal frame stub — the guard reads only `url` and `parent`. */
function frame(url: string, parent: WebFrameMain | null = null): WebFrameMain {
  return { url, parent } as unknown as WebFrameMain
}

/** `null` = explicitly unset (not undefined — that would trigger the default param). */
function setDevServer(url: string | null): void {
  if (url === null) {
    // stubEnv(name, undefined) deletes the var for the test (restored by unstubAllEnvs);
    // a direct `delete` is rejected by TS (process.env is typed readonly here).
    vi.stubEnv('ELECTRON_RENDERER_URL', undefined)
  } else {
    vi.stubEnv('ELECTRON_RENDERER_URL', url)
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isTrustedIpcSender — dev (Vite renderer origin)', () => {
  function devSetup(rendererUrl: string | null = 'http://localhost:5173/'): void {
    mockState.dev = true
    setDevServer(rendererUrl)
  }

  it('rejects a null frame', () => {
    devSetup()
    expect(isTrustedIpcSender(null)).toBe(false)
  })

  it('accepts the exact dev-server origin', () => {
    devSetup()
    expect(isTrustedIpcSender(frame('http://localhost:5173/'))).toBe(true)
    expect(isTrustedIpcSender(frame('http://localhost:5173/some/route?q=1'))).toBe(true)
  })

  it('rejects prefix-spoof hosts (both rejection paths)', () => {
    devSetup()
    // The classic startsWith() bypass string: '5173.evil.com' is an invalid
    // port, so URL parsing throws → rejected via the fail-closed catch.
    expect(isTrustedIpcSender(frame('http://localhost:5173.evil.com/'))).toBe(false)
    // The variant that PARSES cleanly (hostname localhost.evil.com, port 5173)
    // → rejected by the exact-origin comparison itself.
    expect(isTrustedIpcSender(frame('http://localhost.evil.com:5173/'))).toBe(false)
    // Userinfo spoof: parses cleanly with origin http://evil.com AND the raw
    // string prefix-matches the dev origin — the one shape that would defeat a
    // naive startsWith() without throwing. Must lose the origin comparison.
    expect(isTrustedIpcSender(frame('http://localhost:5173@evil.com/'))).toBe(false)
  })

  it('rejects a port mismatch', () => {
    devSetup()
    expect(isTrustedIpcSender(frame('http://localhost:5174/'))).toBe(false)
  })

  it('rejects a scheme mismatch on the right host:port', () => {
    devSetup()
    expect(isTrustedIpcSender(frame('https://localhost:5173/'))).toBe(false)
  })

  it('rejects everything when ELECTRON_RENDERER_URL is unset (fail closed)', () => {
    devSetup(null)
    expect(isTrustedIpcSender(frame('http://localhost:5173/'))).toBe(false)
  })

  it('rejects a malformed frame URL without throwing', () => {
    devSetup()
    expect(isTrustedIpcSender(frame('not a url'))).toBe(false)
    expect(isTrustedIpcSender(frame(''))).toBe(false)
  })
})

describe('isTrustedIpcSender — prod (packaged, file://)', () => {
  function prodSetup(): void {
    mockState.dev = false
  }

  it('accepts a top-level file:// frame', () => {
    prodSetup()
    expect(isTrustedIpcSender(frame('file:///app/out/renderer/index.html'))).toBe(true)
  })

  it('rejects a file:// SUBFRAME (rogue local file in an embedded frame)', () => {
    prodSetup()
    const top = frame('file:///app/out/renderer/index.html')
    expect(isTrustedIpcSender(frame('file:///tmp/evil.html', top))).toBe(false)
  })

  it('rejects non-file schemes in prod (https, dev-server, custom)', () => {
    prodSetup()
    expect(isTrustedIpcSender(frame('https://evil.com/'))).toBe(false)
    expect(isTrustedIpcSender(frame('http://localhost:5173/'))).toBe(false)
    expect(isTrustedIpcSender(frame('vrchat://launch'))).toBe(false)
  })

  it('rejects a null frame in prod too', () => {
    prodSetup()
    expect(isTrustedIpcSender(null)).toBe(false)
  })
})
