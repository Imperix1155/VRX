# Multi-account architecture

This note describes how VRX tracks accounts today and the rules that keep one
account's data away from another. The binding rules for main-process code are
in [`src/main/AGENTS.md`](../../src/main/AGENTS.md); this page explains the
model behind them. Request cancellation and platform etiquette are in
[API policy](../api-policy.md).

## The model

- VRX holds **one signed-in account per platform**. VRChat and ChilloutVR are
  signed in and live at the same time, independently.
- An account's identity is its **canonical platform user id**. There is no
  separate local account id.
- `accountKey(platform, platformAccountId)` in
  [`accountSession.ts`](../../src/main/services/accountSession.ts) is the only
  key derivation: `` `${platform}:${platformAccountId}` ``. Ids must match
  `[A-Za-z0-9_-]` and be at most 128 characters, or the call throws.
- Main owns identity. The renderer may echo an account id back for comparison,
  but main never takes one as input; it qualifies every account-scoped read and
  write itself.
- There is no account switcher. To use another account, the user signs out and
  signs in again on that platform's card in **Settings → Accounts**.

## Account identity and epochs

`AccountSession` keeps, per platform, the current identity and a monotonic
**epoch**. Every real identity change, including a change to "none", increases
the epoch. Setting the same identity again changes nothing.

`resolve(platform)` returns one of:

| Result                                      | Meaning                                                    |
| ------------------------------------------- | ---------------------------------------------------------- |
| Frozen `{ accountKey, epoch, ready: true }` | An account is signed in, validated, and saved              |
| `{ status: 'no-active' }`                   | No account has been resolved on this platform since launch |
| `{ status: 'resolving' }`                   | An account existed this run, but identity is now cleared   |

The adapters feed `AccountSession` through their `onIdentity` callback:

- They publish `null` before every identity-clearing session boundary, so a
  boundary handler can never read the outgoing account.
- They publish the user id only after sign-in, two-factor verification, or
  restore validation has succeeded **and** the credential has been saved.

## Session boundaries

A session boundary happens when an adapter adopts a new session cookie or key,
signs out, loses its session, or (VRChat) is asked for a second factor again.
Each adapter then advances its session generation, aborts its session signal,
clears per-session caches, and restarts or stops its socket.

`main/app.ts` handles each adapter's `onSessionBoundary`:

| Consumer                     | VRChat                                               | ChilloutVR      |
| ---------------------------- | ---------------------------------------------------- | --------------- |
| `FriendAlerts`               | `resetPlatform`                                      | `resetPlatform` |
| `LocationAuthority`          | `clearPlatform`                                      | `clearPlatform` |
| `ExploreService`             | `clearPlatform`                                      | `clearPlatform` |
| `AvatarCache`                | Drops cached failures; successful images stay        | Not touched     |
| Renderer `identity-boundary` | Sent, except for an identity-retaining data-path 401 | Always sent     |

A VRChat data-path 401 sets `identityRetained`. The same account may only need
its second factor again, so `AccountSession` keeps the identity and epoch, and
main clears its own state but sends no `identity-boundary`. The `auth-invalidated` event that follows quarantines the
renderer instead. ChilloutVR has no second factor, so it has no such case.

In the renderer, `useLiveFriendEvents` handles `identity-boundary` for that
platform only. It drops buffered live state, cancels and removes friend-note
queries, cancels the friends query, sets it to `[]` so mounted views clear at
once, invalidates it to load the new roster, and persists the cleared cache
synchronously.

## Stale-write fencing

Async work can finish after the account it belongs to is gone. Each layer
checks ownership at the point of the write:

| Layer               | Fence                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Network requests    | A request lease bound to the adapter's session generation, checked before admission, after admission, and after the response |
| `SocialStore.write` | `{ platform, platformAccountId, epoch }` must equal the current `resolve()` result, or it throws `stale account epoch`       |
| Friend notes IPC    | `get-friend-note` returns `{ platformAccountId, epoch }`; `set-friend-note` must echo it, or the result is `stale`           |
| `AccountRegistry`   | `recordAuthenticated` requires the reported account and epoch to match `AccountSession`                                      |
| Linked profiles IPC | A lease that rotates whenever either platform's resolution changes, plus a per-profile revision on every change              |
| `ExploreService`    | Per-platform state tied to `accountKey` and epoch; work from an older state is cancelled and discarded                       |

## What is stored, and where

All files live under `app.getPath('userData')`.

| File               | Owner                                                                | Scope                                               |
| ------------------ | -------------------------------------------------------------------- | --------------------------------------------------- |
| `accounts.json`    | [`AccountRegistry`](../../src/main/services/accountRegistry.ts)      | Keyed by `accountKey`                               |
| `social.json`      | [`SocialStore`](../../src/main/services/socialStore.ts)              | Keyed by `accountKey`                               |
| `link-graph.json`  | [`LinkGraphStore`](../../src/main/services/linkGraphStore.ts)        | Installation-wide, account-qualified members        |
| `credentials.json` | [`credentials.ts`](../../src/main/services/credentials.ts)           | One slot per platform, not per account              |
| `settings.json`    | [`settings.ts`](../../src/main/services/settings.ts)                 | Global                                              |
| `image-cache/`     | [`imageDiskStore.ts`](../../src/main/services/imageDiskStore.ts)     | Installation-wide, VRChat API-host pictures         |
| `vrchat-metadata/` | [`vrcMetadataStore.ts`](../../src/main/services/vrcMetadataStore.ts) | One file per VRChat account (world and group names) |

An explicit VRChat sign-out deletes both folders' contents. A session boundary
without a sign-out leaves them; the adapter seeds names only for the account
that owns the file.

The renderer's friends cache is in `localStorage` (`vrx-query-cache`), keyed by
platform only. It is kept correct by the identity-boundary clear above and
expires after 24 hours.

### Account registry

`accounts.json` (format version 1) records every account that has signed in.
Each entry holds `platform`, `platformAccountId`, `displayName`, and a state of
`active`, `known`, or `removed`.

- A successful `get-auth-status` for an authenticated account marks it
  `active` and demotes the previous active account on that platform to `known`.
  An unchanged result writes nothing.
- Memory changes only after the write succeeds, so a retry after a failed write
  still tries to persist.
- Sign-out, session loss, and two-factor prompts never change the registry.
- No code creates `removed` entries. The state is still parsed and hidden for
  files written by older builds.
- `get-accounts` returns non-removed entries only for platforms that currently
  have a resolved account. Signed-out callers cannot list account history.

### Social store

`social.json` (format version 1) holds small, bounded overlays per account.
Each namespace is an `AccountScoped<T>` envelope (`schemaVersion`, `platform`,
`platformAccountId`, `data`) validated by a bounded Zod schema.

| Namespace                            | Bound                                        | Used today     |
| ------------------------------------ | -------------------------------------------- | -------------- |
| `notes`                              | 5,000 friends, 10,000 characters each        | Yes            |
| `favorites`                          | 5,000 friends                                | No             |
| `tags`                               | 5,000 friends, 25 tags of 64 characters each | No             |
| `socialPrefs`                        | Notification flags and followed friend ids   | No             |
| `perFriendOptOuts`                   | 5,000 friends                                | No             |
| `instanceHistory`, `activityHistory` | 200-entry ring type                          | Writes refused |

Only friend notes are wired. The notes IPC limits a note to 500 characters. A
read that fails validation or names a different account returns nothing.

### Linked profiles

`link-graph.json` (format version 2) is shared by the whole installation, not
keyed by account. Each profile links exactly one VRChat friend and one
ChilloutVR friend. Each member is `{ platform, platformAccountId, friendId }`,
so a link always records which of the user's accounts owns that friend. A
member belongs to at most one profile, and the file holds at most 5,000
profiles.

- `get-linked-profiles` returns only profiles with at least one member owned by
  a currently signed-in account.
- A new link requires both platforms to be signed in. Main fills in each
  member's `platformAccountId`.
- A profile's shared note (500 characters) belongs to the profile. It is
  separate from the per-account friend notes in `social.json`.
- Writes go to a temporary file, are synced, and replace the file with one
  rename. A version 1 file is converted once and its original kept as
  `link-graph.v1.backup.json`.

### Credentials

`credentials.json` has one slot per platform: `vrchat:primary` and
`chilloutvr:primary`. Signing in with a different account replaces that slot.

- `saveCredential` writes a non-secret invalidation marker before any step that
  can fail, then the new ciphertext. A failed save can never restore the old
  account.
- An explicit ChilloutVR sign-out writes a signed-out marker (older builds read
  it to skip their startup import). A VRChat sign-out deletes the slot. An
  imported sign-in replaces the slot only after the adapter validates its
  owner, like a password login.
- Before a VRChat replacement account's two-factor prompt is shown, the old
  slot is deleted. A failed delete fails the sign-in.
- **No owner is stored.** The adapter learns the owner from the platform during
  sign-in or restore validation and saves the credential before it publishes
  identity. A restored session is validated and saved again before
  authenticated REST or the socket can use it, and on VRChat before API-host
  images can.
- The old credential-owner sidecar (`credential-owners.json`) was write-only
  and has been removed. `removeLegacyCredentialOwnerStore` deletes any leftover
  file at startup.

### Settings

Every setting is global, including the notification toggles. Signing in with
another account does not change settings.

## Not built

- An account switcher, saved accounts per platform, or an add-account flow.
- Per-account credential slots.
- Per-account settings. The `socialPrefs` and `perFriendOptOuts` namespaces
  exist but nothing reads or writes them.
- Favorites, tags, followed friends, and history. `Friend.isFavorite`,
  `favoriteGroupIds`, and `linkedPersonId` are placeholders that adapters always
  set to defaults.
- Account removal, data wipe, and a recovery path for an unreadable store.
- A UI for the account registry. The renderer's `stores/accounts.ts` calls
  `get-accounts`, but no component uses it.

## Rules for contributors

- Key account-scoped data with `accountKey()`. Never key it by display name or
  by credential slot.
- Every write of account-scoped data carries the epoch captured when the data
  was read, and the store compares it with `AccountSession` before writing.
- Publish `null` identity before a clearing boundary. Publish a new identity
  only after the credential is saved.
- Never accept an account id from the renderer. Main qualifies the account.
- A new account-scoped consumer must be cleared from `onSessionBoundary` and,
  if it has renderer state, from the `identity-boundary` handler.
- A new persisted store needs a bounded schema and a format version. It must
  refuse to overwrite a newer format or a file it failed to load, and update
  memory only after the write succeeds.
- Sign-out and session loss keep social data, linked profiles, and registry
  entries. Only an explicit, future wipe may delete them.
- Keep user-authored data in its own store and IPC. Do not build on the
  placeholder `Friend` fields.
- If offline credential ownership is ever needed, store the owner inside the
  same credential record in one write. Do not add a separate owner file.
