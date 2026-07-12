# Multi-Account Data Model — Decision Record (VRX-24)

> Status: **owner-ratified 2026-07-12** (grill round) → **duel-hardened v2** (adversarial
> planning round, Fable×Codex-sol@max, same day). The owner's high-level decisions (D1,
> retain-on-removal, appearance-global/social-per-account intent, one active/platform-both-live)
> are unchanged; the ENGINEERING beneath several was revised after the duel found 3 blockers.
>
> **Milestone that lands this doc (tightened after the duel):** the doc + `@shared` record
> types + the account **registry** (explicit-remove-only tombstones) + a hardened keyed store
> for the SMALL bounded namespaces (runtime-validated bounded Zod) + the **epoch primitive**
> + the **identity-boundary friends-cache reset** (fixes a LIVE stale-roster bug: relogin as a
> different account today keeps the old list until a slow refetch) + the ciphertext-bound
> **credential owner sidecar**. Explicitly NOT built now (seams named in §6):
> append-heavy history storage, the account-switch UI + renderer cache cancellation, the
> favorites vertical, credential re-keying, the linking engine.

## 1. The model in one paragraph

Every piece of user-authored/derived data is scoped to an **account** =
`{platform, platformAccountId}` where `platformAccountId` is the platform's
canonical user id (`AccountSession`, on main). One account per platform is
**active**; both platforms' active accounts are **live at once**. Persisted
per-account data is an **overlay** the renderer composes onto live rosters at the
query boundary — it is NEVER written back onto adapter-owned `Friend` objects.
Account switching, when built, uses a **two-phase epoch** (boundary-clear →
identity-ready). Data survives account removal until an explicit wipe.

## 2. Ratified decisions (v2)

| # | Decision | Ratified choice | Duel revision |
|---|----------|-----------------|---------------|
| D1 | Concurrency | One active/platform, both platforms live | AGREE — unchanged. |
| D2 | Credentials | Data namespaced now; slots re-keyed later (VRX-89) — **but credential OWNERSHIP is bound now** | Bind ownership to the EXACT ciphertext — a sidecar `{platform: {platformAccountId, credentialDigest}}` written atomically with each successful credential save, BACKFILLED only after a validated session restoration for pre-existing credentials — so an old build overwriting a slot can never leave a plausible-but-false owner. No slot re-keying, no auth-path migration. (findings 8, r2-2) |
| D3 | Account removal | Retain data; explicit wipe separate — **via a durable account registry** | A main-owned account **registry** with per-account state `active \| known \| removed(tombstone)`, independent of the retained social data. ONLY an explicit user remove tombstones — logout, auth failure, 2FA re-auth, and identity churn (`onIdentity(null)`) NEVER change registry state (r2-4). Removing → tombstone (data stays, re-add restores); explicit wipe → delete the `accountKey` entry + tombstone. The registry, not the social store, is the source of truth for "which accounts exist." (finding 11) |
| D4 | Settings scope | Appearance global; social per-account — **as an executable field matrix, collapse stays global** | See §4. `collapsedFriendSections` is over a MERGED VRC+CVR list → it **stays global** (it has no single owning account). Per-account = notification prefs + followed-friends. Notification resolution signature becomes `isEnabled(platform, type)` resolving through the active account. The MATRIX is ratified now as the target; the migration + `isEnabled(platform, type)` resolver conversion are DEFERRED to the account-qualified Notifications vertical (r2-3: two live platforms + single global toggles + settings loading before identity exists = no unique migration target today). §4.1 is that vertical's spec, not this milestone's work. (findings 1, 7, r2-3) |
| D5 | Storage | Split by SHAPE, not one store | **Small bounded namespaces** (favorites, notes, tags, socialPrefs, perFriendOptOuts) → one hardened electron-store JSON keyed by `accountKey`. **Append-heavy history** (instanceHistory, activityHistory) → NOT built this milestone; reserved with storage mechanism deferred to its consumer (SQLite or a bounded ring — electron-store's synchronous full-object write is disqualified for append logs). The JSON store gets a **root format version** + downgrade-refusal (`shouldPersistSettings` equivalent) + `accessPropertiesByDotNotation: false` + strict key validation, and every namespace is a **runtime-validated, explicitly BOUNDED Zod schema** (cardinality caps; the settings service's parse-and-catch precedent) — never merely typed. (findings 6, 9, 10, r2-5) |
| D6 | Switching | Two-phase epoch; reuse boundary fencing — **the friends-cache reset must be BUILT (it doesn't exist)** | Correction: `onSessionBoundary` today clears only alerts + LocationAuthority + avatar failures; the friends TanStack cache is NOT cleared (login just invalidates → stale-while-revalidate → A's roster can show while B's events apply). Correction 2 (r2-1): login-over-existing on the Accounts page IS a present-day account switch — the stale-roster hazard already ships. So this milestone builds the **epoch primitive** (§7) AND the **identity-boundary friends-cache reset**: a main→renderer boundary push on every per-platform identity change; the renderer cancels + REMOVES that platform's friends queries (never stale-while-revalidate across an identity change) before the new identity loads. Only the full switch UI stays VRX-90. (findings 2, 3, r2-1) |
| D7 | Cross-platform identity | First-class — **via the EXISTING `LinkedPerson` graph, not an envelope field** | Correction: the envelope-level `personId` was wrong (an `AccountScoped<favorites>` holds many friends — one person id is meaningless) AND redundant (`Friend.linkedPersonId` + `LinkedPerson` already exist in `shared/types.ts`). Linking is an **installation-global graph** of fully-qualified `{platform, platformAccountId, friendId}` members, keyed by a VRX-local `personId`. The graph model is specified; the engine is VRX-143. No `personId` on `AccountScoped`. (finding 4) |
| D8 | Build depth + merge authority | Doc + types + registry + small-namespace store + epoch primitive; **overlay merge authority ratified now** | The persisted local fields are a **query-boundary overlay** composed at `select` time (renderer query layer), NEVER mutated onto adapter `Friend` objects — `applyFriendEvent` stays pure (it wholesale-upserts, so any field written onto a Friend is erased by the next live event). The favorites vertical (hydrate → survives a live event → survives a switch) is the FIRST CONSUMER's contract, ratified here, built next block with favorites. (finding 5) |

## 3. Identifiers (finding 12 — resolved)

Rename `Account.accountId` → **`platformAccountId`** everywhere (`shared/types.ts`
currently mis-documents it as a "stable local id"; it IS the canonical platform
id, same value `AuthStatus`/`AccountSession` already carry). There is NO separate
local UUID — the canonical platform id is the single identity. `accountKey(platform,
platformAccountId)` is the only key derivation.

## 4. Settings scope matrix (D4, executable)

| Field | Scope | Migration on first multi-account boot |
|-------|-------|----------------------------------------|
| theme, density, labelScheme, hotInstanceThreshold, language | **global** — stays in `settings.json` | none |
| collapsedFriendSections | **global** (merged-list, no owning account) | none |
| notifyFriendOnline/InGame/Offline, notifyHotInstance | **per-account** | move to the active account's `socialPrefs`, seeded from the current global value |
| followed-friends (VRX-203) | **per-account** | born per-account (no legacy value) |

### 4.1 Legacy-settings migration (SPEC for the Notifications vertical — NOT executed this milestone, r2-3)

1. On first boot with the new store, for each per-account field: **write** the
   current global value into the active account's `socialPrefs` (main-owned write).
2. **Verify** the social write landed.
3. **Mark** migration complete (a `settingsSocialMigratedV1` flag).
4. **Remove** the legacy fields from `settings.json` ONLY after the mark.
5. `SETTINGS_VERSION` bumps; older builds refuse to persist the newer file
   (`shouldPersistSettings`), preventing strip-and-rewrite downgrade loss.
Crash between any step re-runs safely (the mark gates removal; re-write is
idempotent). The renderer's full-object settings save must not run until the
migration mark is set (else it re-writes the legacy fields).

## 5. Per-account record shape (v2 — no envelope personId)

```ts
interface AccountScoped<T> {
  schemaVersion: number       // per-namespace
  platform: Platform
  platformAccountId: string
  data: T
}
```

Root store envelope carries its own `storeFormatVersion` (D5). Namespaces
reserved now (adding one later = a migration, so owned up front):
`favorites` · `notes` · `tags` · `socialPrefs` · `perFriendOptOuts` (small, JSON,
built this milestone as runtime-validated bounded Zod schemas) · `instanceHistory` · `activityHistory`
(append-heavy, storage deferred to consumer, §6). Cross-platform links are NOT a
per-account namespace — they're the installation-global graph (§D7).

## 6. Deferred, with seams named

- **History storage** (D5) → its consumer (VRX-53/144). Seam: the namespace names
  are reserved; the store layer refuses history writes until the mechanism lands.
- **Per-account credential slots** (D2) → VRX-89. Seam: the owner-map + `accountKey`.
- **Account switch UI** (D6) → VRX-90. Seam: the epoch primitive (§7) + the identity-boundary cache reset (this milestone).
- **Favorites vertical** (D8) → VRX-70/203, next block. Seam: the overlay contract + the small-namespace store.
- **Linking engine** (D7) → VRX-143. Seam: the `LinkedPerson` graph.
- **Wipe cascade** (D3) → VRX-89. Seam: registry tombstone + `accountKey` deletion; the cascade list (social data, link-graph refs, registry, credentials, in-memory snapshots, renderer caches) is enumerated on that issue.

## 7. AccountSession epoch primitive (built this milestone)

`AccountSession` gains, per platform: a monotonic **epoch** (bumped on every
identity change) and a **ready** flag (false until identity is captured
post-auth). The resolver returns an immutable `{ accountKey, epoch, ready }` or a
typed `no-active` / `resolving`. Store operations carry the epoch they were issued
under; a write whose epoch is stale (an A-issued async write landing after a B
switch) is REJECTED. This is the primitive the switch consumer (VRX-90) and the
favorites overlay build on — it exists now so they can't be built racy. No switch
UI, no cache cancellation this milestone.

## 8. Open for the owner (surfaced by the duel, need his call before build)

1. **History storage mechanism** — SQLite (native dep add: `better-sqlite3`, not
   currently present; Electron rebuild + the known V8-version caution) vs a bounded
   JSON ring (cap N entries, no native dep). Deferred to the consumer, but the owner
   should know a native dep is on the horizon.
2. **Milestone size** — the duel expanded the "safe now" surface (registry + epoch +
   hardened store + migration) beyond the original "doc + types + store." Confirm the
   tightened scope in the milestone note above is the right day-one bite, or trim further.
