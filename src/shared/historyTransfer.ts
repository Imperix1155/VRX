/**
 * Moving saved history (owner, 2026-11-15): bringing VRCX's history in, and a
 * backup file for a new computer. Main does all of it; the renderer presses a
 * button and gets counts or a reason in words, never a path or a row.
 */

/** What "Bring in VRCX history" did. VRChat only: VRCX keeps no ChilloutVR
 *  history. */
export type VrcxHistoryImportResult =
  | {
      ok: true
      /** Friends whose "friends since" day is now known. */
      friendsSince: number
      /** Earlier names added. */
      names: number
      /** Rooms added to the instance log. */
      visits: number
      /** VRCX held rooms older than the Keep for choice; they were left out. */
      olderSkipped: boolean
    }
  | {
      ok: false
      /**
       * `off`: activity is not being saved. `signed-out`: no VRChat account.
       * `busy`: VRCX is open. `not-found`: no VRCX data on this computer.
       * `no-history`: VRCX holds nothing for this VRChat account.
       */
      reason: 'off' | 'signed-out' | 'busy' | 'not-found' | 'no-history' | 'failed' | 'rate-limited'
    }

export type HistoryBackupResult =
  { ok: true } | { ok: false; reason: 'off' | 'cancelled' | 'failed' | 'rate-limited' }

export type HistoryRestoreResult =
  | { ok: true }
  | {
      ok: false
      /** `not-a-backup`: the file is not a VRX history backup. `newer`: it was
       *  made by a newer VRX. */
      reason: 'off' | 'cancelled' | 'not-a-backup' | 'newer' | 'failed' | 'rate-limited'
    }
