# App icon

The approved launcher mark is the VRX monogram in one row: a blue V, a silver R
and an orange X at the same size, so neither platform color outweighs the other
(the owner's platform-parity rule). Its smoked-glass case has diagonal cuts,
gently rounded chamfer transitions, and blue/orange rails. The letters and case
keep their colors against the desktop background. The app's horizontal VT323
wordmark remains the in-app brand treatment.

## Source artwork

- [`build/icon.svg`](../build/icon.svg) is the scalable master, on a 64-unit grid.
- [`build/icon-16.svg`](../build/icon-16.svg) and
  [`build/icon-24.svg`](../build/icon-24.svg) retain the same arrangement with
  pixel-aligned letter drawings for small sizes. Keep the V and X the same
  size, the R counter open, and a clear pixel between letters. Do not derive
  these by shrinking the large PNG.
- Blue `#2b7ce8`, silver `#e8e8f0`, and orange `#f3711e` match the app's identity
  tokens in `src/renderer/src/assets/main.css`. These fixed-color icon assets
  do not switch with the app theme. Their outer corners remain transparent.
- The large letter contours derive from the local VT323 font. Its
  [license](../src/renderer/src/assets/fonts/LICENSE-VT323.txt) and
  [provenance](../src/renderer/src/assets/fonts/SOURCES.json) remain with the
  font assets. The SVGs contain paths, not external fonts or links.

The case retains straight diagonal facets. Round their transitions, rather than
replacing the outline with a rounded square. The approved 64-unit master uses
5-unit fillets. Preserve the rail placement and its softer bends.

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
| macOS menu bar                                    | `resources/icon-16.png`, `icon-16@2x.png` | Native 16px optical drawing and its 32px Retina representation                   |
| Linux tray                                        | `resources/icon-24.png`, `icon-24@2x.png` | Native 24px optical drawing and its 48px representation                          |

The Windows 20px frame uses the 24px optical source. Other frames above 24px use
the scalable master. The macOS 16-point Retina representation renders the 16px
optical source at 32px. Keep the PNGs and their matching `@2x` files beside each
other. Tray assets resolve to real `app.asar.unpacked` paths for native OS APIs.
The tray remains colored and retains its existing Show/Hide/Quit behavior.

The generator is excluded from packaged app files, and its renderer is a dev
dependency. End users do not need either. This ICNS is a conventional flattened
Electron icon; it does not claim Icon Composer layers or native adaptive glass.

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
