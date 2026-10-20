# build

## Purpose

Committed app icon sources, generated platform icons, and packaging resources
(electron-builder `buildResources`). The [root contract](../AGENTS.md) still
controls security and release authority.

## Ownership

- `icon.svg`, `icon-16.svg`, and `icon-24.svg` are the editable masters; the
  two small masters supply every 16 px and 24 px frame, including tray `@2x`.
- `icon.png`, `icon.ico`, and `icon.icns` are generated build inputs. Matching
  runtime and tray images are generated into `resources/`.
- `entitlements.mac.plist` is the macOS packaging resource. Icon work does not
  authorize changing entitlements or signing policy.

## Local Contracts

Keep the one-row VRX mark: blue V, silver R, and orange X at equal size, so
neither platform outweighs the other. Keep the dark chamfered case with its
blue and orange rails, softened corner joins, transparent outer corners, and
the dedicated small-size letter drawings. The maintenance procedure and output
map live in [App icon](../docs/APP-ICON.md).

## Work Guidance

Edit the SVG masters, then run `npm run icons:generate`. Commit sources and
outputs together. Do not hand-edit binary containers or replace the small
variants with a reduction of the large PNG.

## Verification

Run `npm run icons:check` and the icon, tray, package-file, and Linux packaging
tests named in the maintenance guide. Apply the root gate for build or runtime
changes. A decoded file or browser sample does not prove a native launcher.

## Child DOX Index

No child contracts.
