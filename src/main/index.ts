import { app, dialog } from 'electron'

// ── Single-instance lock (VRX-230) — the ONLY thing this entry module does. ──
// The heavy main-process bundle is loaded via dynamic import() strictly AFTER
// the lock verdict, so a lock-losing duplicate exits having loaded NOTHING:
// no logger, no safeStorage/keychain reads (which pop a macOS prompt of their
// own), no sockets, no window. app.exit(0) rather than app.quit(): exit is
// immediate, and a duplicate that started nothing has nothing to tear down.
//
// Known platform behavior (probed live + scratch-profile timing matrix,
// 2026-07-31): the synchronous requestSingleInstanceLock() call in a duplicate
// WAITS while the holder's main thread is blocked — the verdict arrives the
// moment the holder unblocks (measured to the ~100ms), so the wait is
// unbounded only if the holder is unboundedly blocked (e.g. an unanswered
// macOS keychain prompt in dev builds). No in-process deadman can bound it —
// the call blocks this process's event loop — and the wait is invisible (no
// window) and self-heals with the holder, so it is accepted rather than
// papered over with an external watchdog. The holder-side blocker is tracked
// separately.
//
// The surviving instance's second-instance handler (foreground the existing
// window) lives in app.ts, which only ever runs holding the lock.
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.exit(0)
} else {
  import('./app').catch((error: unknown) => {
    // Without the app chunk there is no logger and no window — surface the
    // failure natively and exit nonzero (same policy as a bootstrap failure).
    dialog.showErrorBox('VRX failed to start', String(error))
    app.exit(1)
  })
}
