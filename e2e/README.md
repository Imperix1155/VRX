# End-to-end tests

These tests start the real, built VRX app and use it the way a person would:
sign in, look at friends, open every page, rate a world, restart. They catch
what unit tests cannot: a blank window, a page that throws when it opens, a
bridge method nobody registered, a sign-in that is forgotten after a restart.

They never touch a real account. The app talks to a fake VRChat and ChilloutVR
that run on your own computer, and every other connection is refused.

## Run them

```bash
npm run build       # the tests drive out/, the same files a release packages
npm run test:e2e    # about 30 seconds
```

On Linux without a screen (a server, a container, CI) put `xvfb-run -a` in
front: `xvfb-run -a npm run test:e2e`. CI runs them on Windows and Linux after
the build step.

A test that fails once is retried once. A real break fails both times.

## What is in this folder

| File                 | What it does                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smoke.e2e.mjs`      | The test itself. Start here.                                                                                                                                     |
| `app.mjs`            | `launchVrx()` starts the app with a fresh, empty profile (its log included) and returns Playwright's `page` (the window) and `app` (the main process).           |
| `fake-platforms.mjs` | `startFakePlatforms()` starts the fake VRChat and ChilloutVR and returns helpers: `state()`, `sockets()`, `setVrcFriend()`, `vrcEvent()`, `cvrEvent()`, `log()`. |
| `fake-data.mjs`      | The fuller sample data: worlds, favorites, avatars, groups, profiles.                                                                                            |
| `redirect.cjs`       | Loaded into the app before its own code. Sends platform requests to the fake and refuses everything else.                                                        |
| `vitest.config.mjs`  | Test runner settings: one app at a time, long timeouts, one retry.                                                                                               |

The sample accounts: VRChat `tester` / `password`, ChilloutVR
`tester@example.com` / `password`. VRChat friends are Aria Vale (in a public
world), Brick Lane (on the website), Cass Nova (offline), Dex Both (private) and
Echo Hush. ChilloutVR friends are Gale Wind, Dex Both CVR and Hollow Pine.
The VRChat worlds are Fake World, Sunset Lounge and Quiet Library. Every
VRChat room is titled "Friday Hangout".

## Add a test

Add an `it(...)` to `smoke.e2e.mjs`, or a new `something.e2e.mjs` file for a
separate flow. Each test should set up what it needs (open its own page), so
it still passes when it is retried on its own.

- Find things the way a user does: `page.getByRole('button', { name: 'Join' })`,
  `page.getByText('Aria Vale')`. Wait with `.waitFor()` or `expect.poll(...)`,
  never with a fixed sleep. The world rating step holds the only exception;
  its comment says why.
- Change what the platforms say with the fake's helpers, for example
  `fake.setVrcFriend({ id, state: 'offline' })`, then wait for the window to
  show it.
- Check what VRX asked a platform to change with `fake.state().writes`. A
  test that only looks around must leave it empty. A test that presses
  something must find exactly the requests that press should send, as the
  world rating step does.
- When VRX calls a route the fake does not have, the fake answers 404 and
  writes a line with `UNHANDLED` to `fake.log()`. Add the route to
  `fake-platforms.mjs` (or `fake-data.mjs`), shaped the way VRX's parser for it
  expects.

## When a test fails

1. Read the failing step's name and the "waiting for ..." line: it says what
   the test looked for and did not find.
2. Run it yourself and look. Add `await vrx.page.screenshot({ path: 'look.png' })`
   just before the failing line.
3. `reported no error in the window` failing means the app logged an error or
   threw. The message is in the test output.
4. If you changed the shape of a platform reply in a parser, change the
   matching reply in the fake in the same PR.

Do not make a failing test pass by deleting the step or raising a timeout.
The step failed because something a user does stopped working.

## Rules

- A run leaves nothing behind and touches nothing of a VRX installed on the
  same computer: settings, sign-ins, cache and the log all live in a temporary
  folder that is deleted when the app closes.
- `launchVrx()` checks that the redirect is in force before it hands the app
  to a test, and stops the run when it is not. If an Electron update ever
  breaks the redirect, that message is what you see; fix `redirect.cjs`, never
  remove the check.
- The app has no setting that points it at another server and must never get
  one. The redirect only works because the tests start Electron themselves
  with `redirect.cjs` preloaded.
- Nothing in this folder ships: `electron-builder.yml` leaves `e2e/` out of
  the package and `scripts/package-files.test.mjs` checks that.
- Sample data is invented. Never paste a real name, ID, cookie or reply here.
