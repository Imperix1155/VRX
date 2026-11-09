# App icon

The approved launcher mark (owner, 2026-11-09) is the VRX lettering on a
frosted glass chat bubble, built as the app's own layered glass: the app's
blue top-left and orange bottom-right aurora is the canvas, the chat bubble is
a frosted back panel over it, and the letters are glass layers over the
bubble. The R sits behind; the V and X overlap it from both sides at the same
size and depth, so neither platform outweighs the other (the owner's
platform-parity rule). The V and X are a lighter frost tinted in each
platform's color, so the R shows through them. The bubble's tail sweeps to the
bottom left. The tile is a rounded square (superellipse) with transparent
corners. The colors don't change with the app theme or the desktop
background. The app's horizontal VT323 wordmark remains the in-app brand
treatment.

## Source artwork

- [`build/icon.svg`](../build/icon.svg) is the master, on a 64-unit grid. It
  renders every frame above 32 px.
- [`build/icon-24.svg`](../build/icon-24.svg) is the small optical drawing for
  17 to 32 px frames: bigger letters with a solid platform tint, a softer edge
  and no texture, so the letters stay readable.
- [`build/icon-16.svg`](../build/icon-16.svg) is a pixel drawing for 16 px:
  the bubble on the tile with pixel V, R and X. Do not derive the small files
  by shrinking the large PNG.
- Blue `#2b7ce8` and orange `#f3711e` match the app's identity tokens in
  `src/renderer/src/assets/main.css`.
- The letter outlines are Inter Black, the family the app already bundles
  under the SIL Open Font License (see its
  [license](../src/renderer/src/assets/fonts/LICENSE-Inter.txt)). The SVGs
  contain paths, not fonts or external links.

The master is drawn flat: each glass pane blurs the canvas once and repeats
the panes under it as plain fills, instead of re-rendering the whole stack
for every pane. Keep it that way; a nested stack takes the renderer over ten
seconds per large frame. Write saturation as `feColorMatrix type="matrix"`,
because the renderer clamps `type="saturate"` to 1.

## Regenerate and verify

Use the project's documented Node/npm toolchain and install with `npm ci`.
Then run:

```bash
npm run icons:generate
npm run icons:check
npx vitest run scripts/app-icons.test.mjs src/main/tray.test.ts scripts/linux-packaging.test.mjs scripts/package-files.test.mjs
```

The exporter uses the pinned development-only SVG renderer. It needs no system
font, image editor, Python installation, or personal agent skill. It writes
the following committed assets; `icons:check` compares every output without
writing. Commit the sources and regenerated outputs together.

| Consumer                                          | Asset                                     | Contents                                                                         |
| ------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------- |
| Windows installer, portable executable, shortcuts | `build/icon.ico`                          | PNG frames at 16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 128 and 256 px |
| macOS app bundle and Dock                         | `build/icon.icns`                         | 16 through 1024 px, including explicit Retina representations                    |
| Linux AppImage/deb launcher                       | `build/icon.png`                          | 512px RGBA PNG; existing desktop identity and package checks still apply         |
| Linux window icon and native friend notifications | `resources/icon.png`                      | Identical 512px master                                                           |
| Windows tray                                      | `resources/icon.ico`                      | Same multi-size ICO as the executable                                            |
| macOS menu bar                                    | `resources/icon-16.png`, `icon-16@2x.png` | Native 16px pixel drawing and its 32px Retina representation                     |
| Linux tray                                        | `resources/icon-24.png`, `icon-24@2x.png` | Small optical drawing at 24px and its 48px representation                        |

Windows frames from 20 to 32 px and the macOS 32 px representation use the
small optical source. Other frames above 32 px use the master. The macOS
16-point Retina representation renders the 16px pixel drawing at 32px. Keep
the PNGs and their matching `@2x` files beside each other. Tray assets resolve
to real `app.asar.unpacked` paths for native OS APIs. The tray remains colored and retains its existing Show/Hide/Quit behavior.

The generator is excluded from packaged app files, and its renderer is a dev
dependency. End users do not need either. This ICNS is a conventional flattened
Electron icon; the glass is drawn into the artwork, not Icon Composer layers or
native adaptive glass.

## Visual and package checks

Run `npm run guide:dev` and inspect the Identity section of
`http://127.0.0.1:4173/design.html`. The standalone sample is
`glass.html?scene=icons`. It imports the actual packaged PNGs, including the
small optical exports, and supports both themes and grayscale. The guide's
favicon also uses these assets.

The format tests validate native container offsets, dimensions, RGBA payloads,
package configuration, and source/output agreement. Before shipping a release,
also inspect the packaged icon on the relevant OS: Windows executable, installed
shortcut, pinned taskbar, and tray; Linux launcher, window, and tray where
supported; macOS Finder, Dock, and menu bar for a local build. An existing pinned
shortcut or OS icon cache may need refreshing after installing a new build.
See [Releasing](RELEASING.md) for packaging and delivery authority.
