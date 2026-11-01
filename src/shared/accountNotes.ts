/**
 * Friend notes kept on the signed-in VRChat or ChilloutVR account as well as
 * in VRX. Pure: bundled into both processes.
 *
 * VRX keeps its own copy of every note (SocialStore) and, when the user allows
 * it, copies it to the account. The two can drift: the user may edit a note in
 * the game or on the website. VRX remembers the last text both copies agreed on
 * and decides from that, so it never silently replaces a note that changed on
 * the other side:
 *
 *   - both still match              → nothing to do
 *   - only VRX's copy changed       → save it to the account (after an edit)
 *   - only the account copy changed → VRX takes the account copy
 *   - both changed                  → ask the user which to keep
 */
import type { Platform } from './types'

/** VRChat keeps notes on one line, at most 256 characters (VRCX uses the same cap). */
export const VRCHAT_ACCOUNT_NOTE_MAX_LENGTH = 256
/** Spacing between two note writes on the same platform. */
export const ACCOUNT_NOTE_WRITE_SPACING_MS = 2_000
/** A check reuses the account copy it read this recently instead of asking again. */
export const ACCOUNT_NOTE_CHECK_REUSE_MS = 5 * 60_000

/**
 * - `check`: read the account copy and compare. Never writes to the platform.
 * - `save`: the same, then save VRX's copy when only VRX's copy changed.
 * - `keep-mine`: the user chose VRX's copy over a different account copy.
 * - `use-account`: the user chose the account copy, or VRX takes it because
 *   only the account copy changed.
 */
export type AccountNoteSyncMode = 'check' | 'save' | 'keep-mine' | 'use-account'

export type AccountNoteSyncFailure =
  'not-authenticated' | 'rate-limited' | 'unavailable' | 'stale' | 'invalid' | 'not-friend'

export type AccountNoteSyncResult =
  | {
      ok: true
      /**
       * - `saved`: both copies hold the same note.
       * - `local-only`: VRX's copy is not on the account yet; a save sends it.
       * - `too-long`: VRX's copy is longer than the platform keeps.
       * - `off`: the user turned account notes off in Settings.
       */
      state: 'saved' | 'local-only' | 'too-long' | 'off'
      /** VRX's copy after the call (it changes after `use-account`). */
      note: string
    }
  | {
      ok: true
      /**
       * - `account-changed`: only the account copy changed since they last
       *   matched. The drawer takes it with `use-account` unless the user is
       *   typing, and asks otherwise.
       * - `conflict`: both changed. The user picks one.
       */
      state: 'account-changed' | 'conflict'
      note: string
      /** The account copy, readable (VRChat's look-alike symbols put back). */
      accountNote: string
    }
  | { ok: false; reason: AccountNoteSyncFailure }

export type AccountNoteDecision = 'in-sync' | 'take-account' | 'send-local' | 'conflict'

// VRChat swaps these characters for look-alikes in user text. The list matches
// VRCX's `replaceBioSymbols`, plus U+037E for the semicolon.
const VRCHAT_LOOKALIKES: ReadonlyArray<readonly [string, string]> = [
  ['＠', '@'],
  ['＃', '#'],
  ['＄', '$'],
  ['％', '%'],
  ['＆', '&'],
  ['＝', '='],
  ['＋', '+'],
  ['⁄', '/'],
  ['＼', '\\'],
  [';', ';'],
  ['˸', ':'],
  ['‚', ','],
  ['？', '?'],
  ['ǃ', '!'],
  ['＂', '"'],
  ['≺', '<'],
  ['≻', '>'],
  ['․', '.'],
  ['＾', '^'],
  ['｛', '{'],
  ['｝', '}'],
  ['［', '['],
  ['］', ']'],
  ['（', '('],
  ['）', ')'],
  ['｜', '|'],
  ['∗', '*']
]

/** An account note as people read it: VRChat's look-alike symbols put back. */
export function readableAccountNote(platform: Platform, note: string): string {
  if (platform !== 'vrchat') return note.replace(/\r\n?/g, '\n').trimEnd()
  let text = note
  for (const [lookalike, plain] of VRCHAT_LOOKALIKES) text = text.split(lookalike).join(plain)
  return text.replace(/ {2,}/g, ' ').trimEnd()
}

/** The text VRX sends to the account for its own copy. */
export function accountNoteToSend(platform: Platform, note: string): string {
  const text = note.replace(/\r\n?/g, '\n').trim()
  // VRChat notes are one line; VRCX strips line breaks the same way.
  return platform === 'vrchat' ? text.replace(/\s*\n\s*/g, ' ') : text
}

/**
 * The form two copies are compared in. VRX's multi-line note and VRChat's
 * one-line copy of it count as the same note.
 */
export function comparableNote(platform: Platform, note: string): string {
  return readableAccountNote(platform, accountNoteToSend(platform, note))
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whether VRX's copy fits on the account. */
export function fitsAccountNote(platform: Platform, note: string): boolean {
  return (
    platform !== 'vrchat' ||
    accountNoteToSend(platform, note).length <= VRCHAT_ACCOUNT_NOTE_MAX_LENGTH
  )
}

/**
 * Three-way decision between VRX's copy, the account copy, and the last text
 * both agreed on (`agreed`, undefined when they never matched). All three are
 * in {@link comparableNote} form.
 */
export function decideAccountNote(
  local: string,
  account: string,
  agreed: string | undefined
): AccountNoteDecision {
  if (local === account) return 'in-sync'
  if (agreed !== undefined) {
    if (local === agreed) return 'take-account'
    if (account === agreed) return 'send-local'
    return 'conflict'
  }
  // Never matched before. An empty side loses nothing, so the other copy wins.
  if (local === '') return 'take-account'
  if (account === '') return 'send-local'
  return 'conflict'
}
