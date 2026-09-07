# Linked friends smoke-test findings

Status: owner authorized the two-item fix round on September 7, 2026. Both fixes
are implemented and locally verified; review and delivery are pending. The
installed app has not been updated by this round. No new merge or release grant.

Test build: macOS arm64 `0.20.0-local.20260906.22f7bb4`.
Related work: [execution ledger](2026-09-05-linked-friends-progress.md).
Real friend names and account identifiers are intentionally omitted.

## Fix-round summary

1. Restore a neutral, non-actionable `Private` instance pill for an in-game
   linked person whose location is unavailable. Keep privacy protections and
   Join eligibility unchanged. Investigate any world-caption change separately.
2. In the initial unlinked Identities dialog, keep the footer dismiss button
   and change `Done` to `Close`. Preserve its position, the top X, and behavior.

Both expected outcomes are approved for the later fix round. No additional
defect was confirmed in this smoke-test session. The detailed evidence and
acceptance checks below distinguish observed behavior from owner reports.

## Remaining manual checks, not confirmed defects

- One linked person in-game on both platforms at once, plus live presence
  transitions and platform filters during those transitions.
- Persistence across an ordinary app update, not just a restart.
- Shared-note versus individual-account-note separation through navigation.
- Cancellation from the candidate picker after selecting Link account.
- Final unlink results and note preservation/deletion, using disposable test
  data with explicit acknowledgement of shared-note deletion.
- Preferred-platform and picture-mode persistence were not individually
  confirmed; links, notes, and naming passed the owner's restart test.

## Finding 1: missing Private instance pill on linked people

Status: implemented; focused regression and isolated runtime checks pass.

### Observation

- Owner reports two separate linked people, each in-game on only one platform:
  one on VRChat, the other on ChilloutVR. Neither is in-game on both platforms.
- With the owner's one-time capture permission, the installed VRX window's
  accessibility state showed the fourth and fifth in-game rows with `VRC Hidden`
  and `CVR Hidden`. Neither exposed an instance join button. The owner reports
  the instance pill itself is absent and the behavior is repeatable.
- The VRChat row showed Ask Me status. The owner suspects both locations are
  inaccessible to their account. That explanation is not verified for both
  people; no platform API requests or private account-data inspection were made.

### Expected behavior confirmed by the owner

An in-game linked person whose instance cannot be seen should still have a
neutral, non-actionable `Private` instance pill, consistent with ordinary friend
rows. Joining must remain unavailable. Linking must not require both accounts
to be in-game simultaneously.

### Source evidence

- `src/renderer/src/components/FriendsList.tsx` computes a Private fallback for
  an in-game friend, but its pill-rendering condition requires a combined row
  to be joinable: `instancePill !== null && (!combined || joinable)`.
  Thus a linked row with no joinable destination suppresses the neutral pill
  that an ordinary row retains. Displaying information and permitting Join are
  incorrectly coupled for this reported case.
- `src/renderer/src/components/LinkedWorlds.tsx` separately renders `Hidden`
  when `isHotInstanceMember` is false. That includes a VRChat Ask Me/DND account
  or an in-game account with no instance details. The observed caption alone
  does not prove incorrect presence or location data.

### Deferred fix-round checks

- Add a regression case for one in-game account plus one offline account on
  each platform, with unavailable location and no joinable destination.
- Verify a neutral Private pill remains visible without enabling Join or
  exposing a restricted world, image, or instance identifier.
- Preserve known-instance labels, ordinary rows, two-destination behavior,
  and both themes. Distinguish an unavailable location from a known but
  non-joinable instance; do not blindly label all non-joinable instances Private.
- Check whether any world-caption change is needed separately. The owner
  confirmed the Private pill outcome, not removal of every Hidden caption.

## Finding 2: unclear dismissal control before linking an account

Status: approved design implemented; English/Japanese dismissal checks pass.

- Reproduction: open an unlinked friend's profile, select Identities, and see
  the introductory dialog inviting a link to a friend on another platform.
- Current controls: `Link account` and `Done`. The owner finds `Done` confusing
  before any linking action has occurred.
- Approved decision: keep the footer dismiss button in its current position
  and rename `Done` to `Close` in this introductory state. Preserve the top X,
  `Link account`, and existing dismissal behavior. Dismissing must not create
  or alter a link.
- Rationale: Close describes leaving the panel without implying rollback of
  saved changes, and keeps an explicit text exit control. This supersedes the
  tentative Cancel rename and the alternative of removing the footer button.
- Design approval was followed by explicit fix-round authorization on September 7.
- Source confirmation: `IdentitiesDialog.tsx` uses `linking.manage.done` for
  the shared footer dismiss control, including the unlinked introductory state.
- Scope is this reported pre-link state. Do not globally replace Done in
  already-linked management or other dialogs. In particular, Cancel must not
  imply rollback of changes that have already been saved.
- Deferred checks: Close label, unchanged dismissal and keyboard/focus behavior,
  localization parity, and the relevant design documentation.

## Smoke-test coverage update

- Offline platform filters: owner-tested pass on an offline linked friend.
  CVR shows the CVR profile and platform marker; All shows the VRX marker;
  VRC shows its platform marker, account name, and profile picture. This does
  not establish the same filter behavior during live presence transitions.
- Initial Identities dismissal: owner reports backing out without saving or
  changing anything. Behavior passes; the approved Close wording in Finding 2
  is implemented and locally verified, not yet installed for the owner.
- Link-account picker: owner reports search works and candidates are filtered
  to the correct platform. Cancellation from this second step was mentioned
  as a planned check but its result was not explicitly reported.
- Unlink confirmation: owner reports the warning appears correctly and the
  acknowledgement checkbox is required before the Unlink button becomes
  enabled. Record a pass for the confirmation safeguard. Final unlink storage
  results, account-note preservation, and shared-note deletion were not
  individually reported, so do not infer those outcomes from this check.
- Owner reports linking is working reasonably well so far, apart from the
  recorded findings. This is preliminary user feedback, not a complete pass.
- A linked person simultaneously in-game on VRChat and ChilloutVR has not yet
  been exercised in the owner's real-account smoke test. Keep this case pending;
  prior synthetic coverage does not establish real-account verification.
- The owner may ask a friend to exercise both platforms when convenient.
  No assistant outreach, account action, or monitoring is requested.
- Restart persistence: owner reports quitting and reopening VRX and confirms
  the links, notes, and naming persisted. Record this as an owner-tested pass
  for linked pairs, notes, and naming, not independent assistant observation.
  The owner's overall impression is that everything survives restart; preferred
  platforms and picture modes were not individually confirmed.
- Update persistence: still pending. The owner wants to verify saved links
  survive an app update and may have a friend test that path. A restart pass
  does not establish update or migration behavior. For that later test, record
  source and destination versions and compare linked pairs and configured
  shared settings/notes before and after an ordinary update, using the same
  accounts and application data. No update or outreach is requested now.
- Presence and row placement can legitimately change during a restart or update.
  Do not log out, clear application data, or force-quit as part of these checks.
  The assistant has not quit, restarted, or updated the app during this
  smoke-test session.

## Recording scope

The initial smoke-test session changed only this log and its execution-ledger
link. The subsequent authorized fix round changed FriendsList, IdentitiesDialog,
their tests, the renderer contract, all three design references, and CHANGELOG.
INTERNAL-API, README, and API policy/volatility intentionally remain unchanged:
no callable surface, stack, platform request, or API assumption changed.

## September 7 implementation evidence

- Branch: `imperix/vrx-143-linked-smoke-fixes`, based on merged main `22f7bb4`.
  Original local smoke-test notes are preserved. No overlapping open PR existed.
- Creating a follow-up Linear issue failed because the workspace reached its
  free issue limit. No new issue was created, no completed issue reopened, and
  no subscription changed. This round references original VRX-143.
- Baseline focused tests: 28 passed. Six new regression cases then failed for
  missing pills/Close footer. After the minimal fixes and Japanese coverage,
  35 focused cases passed. Known non-joinable CVR labels and linked-management
  Done are explicitly preserved. Existing joinable-counterpart coverage passes.
- Full gate: 2,439 tests across 159 files, typecheck, uncached ESLint, formatting,
  build and diff checks passed with `SMOKE_FIX_GATE_GREEN`.
- Isolated Electron fixture: `/private/tmp/vrx-smoke-runtime.Stl5TZ`.
  `SMOKE_RUNTIME_GREEN` covered each single-platform hidden case, both hidden,
  known CVR Offline Instance and both offline in dark/light. Private pills are
  neutral 78×28 non-buttons contained in their rows; no unavailable case enables
  Join. Native Identities modality, Tab containment, footer Close, unchanged X,
  opener focus restoration and zero writes/launches passed. The probe initially
  compared a hex token to computed rgba; normalizing both through the browser
  fixed the probe, not production styling.
- Runtime verification used current source and compiled CSS with synthetic
  data, disposable userData and blocked network. No screenshots, real account
  actions, installed-app replacements, or external launches occurred.
- Review, commit, PR and final-head CI are not yet complete. Prior linking-PR
  review exceptions do not carry over to this new fix round.
