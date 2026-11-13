# Maintaining VRX

A working guide for whoever keeps VRX healthy: where to look when something
breaks, how to make the common changes step by step, and which automatic
check catches which mistake. It adds no rules. The rules are in the
[contract](../AGENTS.md) and the `AGENTS.md` files beside the code; when this
page and a contract disagree, the contract wins and this page needs fixing.

## The loop for every change

1. Start from the newest `dev`: `git fetch origin dev`, then
   `git switch -c <branch> origin/dev`.
2. Read the `AGENTS.md` files on the path to the files you will change.
3. Make the smallest change that does the job. For a bug, first write a test
   that fails because of the bug.
4. Run the test file you touched: `npx vitest run path/to/file.test.ts`.
5. Run the full gate: `npm run verify`.
6. When the change can affect the running app, also run
   `npm run test:e2e` (it uses the build `verify` just made) and look at the
   change in the app or the [design guide](DEVELOPMENT.md#design-guide), in
   dark and light.
7. Add a line to `CHANGELOG.md` under `[Unreleased]` when a user would notice
   the change, and update the docs the
   [documentation list](../AGENTS.md#documentation-sync) names.
8. Open a pull request into `dev`. Wait for `ci-success` and the review bots,
   and answer what they found, before anyone merges.

A green check is evidence, not proof. If you changed what a user sees or
does, look at it.

## Where to look, by symptom

| What is wrong                                     | Start here                                                                                                                                                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The top bar says Down or Connecting for too long  | [`ReconnectingPipeline.ts`](../src/main/services/adapters/ReconnectingPipeline.ts), [`appStatus.ts`](../src/main/services/appStatus.ts), [`queries/appStatus.ts`](../src/renderer/src/queries/appStatus.ts)                    |
| A friend is missing, or shows the wrong status    | The parsers in [`adapters/vrchat`](../src/main/services/adapters/vrchat) and [`adapters/cvr`](../src/main/services/adapters/cvr), then [`queries/friends.ts`](../src/renderer/src/queries/friends.ts)                          |
| Sign-in fails, or is forgotten after a restart    | [`VrcAdapter.ts`](../src/main/services/adapters/VrcAdapter.ts), [`CvrAdapter.ts`](../src/main/services/adapters/CvrAdapter.ts), [`credentials.ts`](../src/main/services/credentials.ts)                                        |
| Join does nothing, or opens the wrong place       | [`ipc/launch.ts`](../src/main/ipc/launch.ts), [`joinCoordinator.ts`](../src/main/services/joinCoordinator.ts), [`gameHandoff.ts`](../src/main/services/gameHandoff.ts)                                                         |
| A link will not open                              | [`ipc/url-allowlist.ts`](../src/main/ipc/url-allowlist.ts). Add a host only when the owner asked for it.                                                                                                                       |
| A setting does not stick                          | [`shared/settings.ts`](../src/shared/settings.ts) (the schema), [`services/settings.ts`](../src/main/services/settings.ts) (the file), [`stores/settings.ts`](../src/renderer/src/stores/settings.ts)                          |
| An alert does not fire, or fires when it must not | [`friendAlerts.ts`](../src/main/services/friendAlerts.ts), [`friendNotifications.ts`](../src/main/friendNotifications.ts), [`vrOverlayAlerts.ts`](../src/main/vrOverlayAlerts.ts)                                              |
| "Too many requests", or a read that never comes   | [`ApiAdmissionController.ts`](../src/main/services/adapters/ApiAdmissionController.ts) (platform requests), [`ipc/rate-limit.ts`](../src/main/ipc/rate-limit.ts) (window to main). Read the [API policy](api-policy.md) first. |
| A page is blank or shows "Something went wrong"   | Run `npm run test:e2e`; it opens every page and prints the error. Then [`AppShell.tsx`](../src/renderer/src/components/AppShell.tsx) and the page's own component.                                                             |
| Text is wrong, missing or not translated          | [`locales/en`](../src/renderer/src/locales/en/translation.json) and [`locales/ja`](../src/renderer/src/locales/ja/translation.json); main-process text is in [`main/i18n.ts`](../src/main/i18n.ts)                             |
| Colors, spacing or glass look wrong               | [`main.css`](../src/renderer/src/assets/main.css) and [Design](DESIGN.md). Check both themes.                                                                                                                                  |
| An update does not arrive                         | [`updater.ts`](../src/main/updater.ts), [`updateFeed.ts`](../src/main/updateFeed.ts), then [Releasing](RELEASING.md#3-verify-publication)                                                                                      |
| A platform changed a reply and something broke    | The parser for that reply (search the [catalog](INTERNAL-API.md)), then record the new shape in [API volatility](api-volatility.md)                                                                                            |

Not in the table? Search the [internal API catalog](INTERNAL-API.md) with
`rg -n 'word' docs/internal-api`. It lists every channel, event, hook, store,
parser, service and constant with a link to its file.

The app's own log helps too: Settings has an "Open logs folder" button.
Credentials are redacted and failure lines are written without names or
locations, so a log line names the step that failed. Still read a log before
sharing it.

## Recipes

Each recipe lists every file to touch, in order. When a step is skipped, the
check named in [What catches what](#what-catches-what) fails.

### Change or add text

1. Edit the key in `src/renderer/src/locales/en/translation.json`.
2. Make the same change in `locales/ja/translation.json`. Every key exists in
   both files.
3. A new key is used in a component with `t('section.key')`. Never write
   user-visible text straight into a component.
4. Keep it short and plain. Name the platforms (VRChat, ChilloutVR), never the
   companies behind them.
5. Look at the Japanese text at the smallest window (900×670); it is often
   longer than the English.

### Add a setting

1. Add the field to `SettingsSchema` in `src/shared/settings.ts` with a
   `.catch(<default>)`, so a bad stored value falls back instead of failing.
2. Raise `SETTINGS_VERSION` by one and add a migration for the previous
   number to `SETTINGS_MIGRATIONS`. For a new field it is
   `(prev) => ({ ...prev })` with a comment saying what was added. Never
   remove or renumber an old migration.
3. Add a test in `src/shared/settings.test.ts` that loads a file from the
   previous version and one with a bad value.
4. Add the control to `src/renderer/src/components/SettingsView.tsx` and its
   text to both translation files. A new alert or automatic action defaults
   to off.
5. If main must act on it, read it with `getSettingsSnapshot()` at the moment
   it matters, not once at startup.
6. Update the settings row in `docs/internal-api/7-shared.md` and add a
   changelog line.

### Add a channel between the window and main

A channel is how the window asks main for something. Reuse one that exists
when it fits.

1. `src/shared/ipc.ts`: add the name with its request and result types to
   `IpcInvoke`.
2. `src/main/ipc/rate-limit.ts`: add a budget to `IPC_RATE_LIMIT_BUDGETS`.
   The build fails until it has one.
3. `src/main/ipc/<area>.ts`: write the handler. First line:
   `if (!isTrustedIpcSender(event.senderFrame)) throw …`, as every other
   handler does. Check the shape of the request before using it. Call a
   service; keep policy out of the handler.
4. `src/main/ipc/index.ts`: register it (a new file gets a `register…Handlers`
   call there).
5. `src/main/ipc/index.test.ts`: add the name to `EXPECTED_INVOKE_CHANNELS`
   (the list is in alphabetical order).
6. `src/preload/index.ts` and `src/preload/index.d.ts`: add the typed method
   to `window.vrx`.
7. `src/renderer/src/queries/`: call it from a query or mutation hook, never
   straight from a component.
8. `docs/internal-api/1-renderer-bridge.md` and `2-ipc-channels.md`: add the
   rows.

The window never sends a launch URL, a file path, an account or a world ID
to act on. It sends a platform and an ID main already knows, and main looks the
rest up. Read [`src/main/ipc/AGENTS.md`](../src/main/ipc/AGENTS.md) before
adding a channel that changes anything.

### Add a page

1. `src/renderer/src/stores/ui.ts`: add the name to `ActiveTab`.
2. `src/renderer/src/components/AppShell.tsx`: add the `case` that renders
   it. TypeScript points at the switch until you do.
3. `src/renderer/src/components/Sidebar.tsx` and `NavIcons.tsx`: add the
   entry and its icon; add the title to both translation files.
4. A page users can hide also needs a `show…Page` setting (see
   [Add a setting](#add-a-setting)) and a line in
   `src/renderer/src/utils/pages.ts`.
5. Add a scene to the [design guide](guide/AGENTS.md) and a step to
   `e2e/smoke.e2e.mjs` that opens the page and finds something on it.
6. Both platforms get the same layout, fields and wording.

### Change how a platform reply is read

1. Read the [API policy](api-policy.md). A new request, or the same request
   more often, needs a reason VRCX or CVRX would also accept.
2. Change the parser and its test. Unknown or missing values must end as
   "unknown" or `null`, never as a guess.
3. Change the matching sample reply in `e2e/fake-platforms.mjs` or
   `e2e/fake-data.mjs`, so the end-to-end test speaks the new shape.
4. Record the observed shape in [API volatility](api-volatility.md).

### Change a color, size or spacing

1. Change the token in `src/renderer/src/assets/main.css`. Dark is the base;
   light overrides the same token under `[data-theme='light']`.
2. Run `npm run design:tokens` so the tables in `DESIGN.md` match.
3. Look at the [design guide](DEVELOPMENT.md#design-guide) in both themes.
   Never change the design language itself (the numbered Locked rules in
   [Design](DESIGN.md)) without the owner.

### Accept a dependency update

Dependabot opens its pull requests against `dev`, once a week.

1. Read what changed upstream. A major version gets its release notes read
   in full.
2. Wait for `ci-success`. It includes the end-to-end test on Windows and
   Linux, which is what tells you Electron or a build tool still works.
3. An Electron, Vite, React or TypeScript update also gets a look at the
   running app (`npm run dev`, sign in with a test account or use the design
   guide).
4. Merging needs the owner's permission, like every merge.

Adding a package yourself: run `npm install <name>` and then read
`git diff package-lock.json`. On Linux, npm sometimes deletes the `"libc"`
lines of packages you did not touch. If it did, restore the file
(`git checkout package-lock.json`) and install on Windows or macOS, or put
back only the lines for your package. `scripts/lockfile.test.mjs` fails when
those lines are gone, because without them a Linux build can pick the wrong
native files.

## What catches what

Every row is a mistake that has happened or nearly happened, and the check
that now stops it. When one of these fails, fix the cause. Never delete the
test, skip it or loosen the rule to get a green run.

| Mistake                                                     | What fails                                                                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| A text key in English but not Japanese, or the reverse      | `src/renderer/src/i18n/parity.test.ts`                                                              |
| A channel with no budget, or one nobody registered          | The build (`rate-limit.ts`) and `src/main/ipc/index.test.ts`                                        |
| The window imports Electron, Node or main-process code      | `npm run lint` (`no-restricted-imports` in `eslint.config.mjs`)                                     |
| Main imports window code, or `src/shared` imports either    | `npm run lint`, same rule                                                                           |
| `console.log` left in app code                              | `npm run lint` (`no-console`). Use the logger in `src/main/logger.ts`.                              |
| A page throws when it opens; a blank window                 | `npm run test:e2e`                                                                                  |
| A sign-in that is forgotten after a restart                 | `npm run test:e2e`, and CI's saved-session probe on Linux                                           |
| A real-looking cookie, token, key or home folder path       | `scripts/check-secrets.mjs` (pre-commit hook and `npm test`), gitleaks in CI                        |
| An inline style or script that the shipped CSP would block  | `scripts/renderer-csp.test.mjs`, `scripts/dev-style-csp.test.ts`                                    |
| Docs, tests or tools packed into the installer              | `scripts/package-files.test.mjs`                                                                    |
| A token or class named in `DESIGN.md` that does not exist   | `docs/guide/design-doc.test.ts`                                                                     |
| A broken link or heading anchor in the docs                 | `npm run docs:links` (also part of `npm test`)                                                      |
| An `AGENTS.md` chain too long for a bounded reader          | `scripts/agents-contract-size.test.mjs`. Shorten text; do not raise the limit.                      |
| A lockfile that lost its platform lines, or a stale version | `scripts/lockfile.test.mjs`                                                                         |
| A dependency with a high or critical advisory               | The `audit` job (`scripts/audit-policy.mjs`)                                                        |
| An alert or activity row that names a hidden friend's world | `src/main/friendNotificationPrivacy.test.ts`                                                        |
| A release with an empty changelog section, or over red CI   | [`release.yml`](../.github/workflows/release.yml) (`extract-changelog.mjs`, `require-green-ci.mjs`) |

Some mistakes have no automatic check. Keep them in mind in review:

- Asking a platform for more, or more often. Nothing counts requests for you.
  Never add a timer that reads friends, profiles or worlds.
- A write that happens without a press, more than once, or for the wrong
  account. Every write goes through its own service; copy the nearest one.
- One platform getting a feature, field or nicer wording the other could
  also have.
- Color as the only signal. Add a word, glyph or shape.
- Text that explains a security weakness. Say "security hardening" and stop.
- Personal information: a real name, account ID, email or home folder in a
  test, a comment, a commit or a screenshot.

## When a check fails

1. Read the first error, not the last. `verify` stops at the first failing
   step.
2. Run only the failing file while you fix it, then the full gate once.
3. Check whether it also fails on unchanged `dev`. If it does, it is not
   yours, but say so in the pull request instead of ignoring it.
4. A test that fails only sometimes is a bug in the test or the code. One
   re-run can help you see it; a later pass does not explain it.
5. Formatting: `npm run format` fixes it. Lint: most messages say what to do;
   an `eslint-disable` needs a comment with the reason.

## Releases, in short

[Releasing](RELEASING.md) is the full procedure. The shape:

- Work lands in `dev`. A version pull request (`package.json`, the lockfile
  and a dated `CHANGELOG.md` section) into `dev` publishes a dev test build
  named like `1.4.5-dev.1`.
- A stable release is a pull request from `dev` into `main` with a plain
  version such as `1.4.5`. Merging it publishes to everyone on the stable
  channel.
- After a stable release, bring `dev` and `beta` level with `main` again
  through pull requests, so all three hold the same code.
- Merging a version pull request publishes. Nothing can take a published
  version back; a bad one is fixed by the next version.

## Only the owner can do these

- Give permission to merge, publish or replace an installed copy.
- Change repository settings on GitHub: branch protection, required checks,
  and secret scanning with push protection (Settings → Code security).
- Approve a change to the design language, a new platform write, or a new
  host on the link and image allowlists.
- Rewrite history, delete a branch or delete a release.
