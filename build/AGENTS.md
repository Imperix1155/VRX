# build

## Purpose

Committed app icon sources, generated platform icons, and packaging resources
(electron-builder `buildResources`). The [root contract](../AGENTS.md) still
controls security and release authority.

## Ownership

- `icon.svg`, `icon-16.svg`, and `icon-24.svg` are the editable masters;
  `icon-16.svg` supplies 16 px (and the macOS tray `@2x`), `icon-24.svg` every
  frame from 17 to 32 px plus the Linux tray `@2x`.
- `icon.png`, `icon.ico`, and `icon.icns` are generated build inputs. Matching
  runtime and tray images are generated into `resources/`.
- `entitlements.mac.plist` is the macOS packaging resource. Icon work does not
  authorize changing entitlements or signing policy.

## Local Contracts

Keep the frosted glass chat bubble mark: glass V, R and X on a frosted bubble
over the blue/orange aurora, with the V and X at equal size and depth over the
R, so neither platform outweighs the other. Keep transparent tile corners and the
dedicated small-size drawings. Keep the master flat (one blur of the canvas per
pane, saturation as an explicit matrix) so the renderer stays fast. The
maintenance procedure and output map live in [App icon](../docs/APP-ICON.md).

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
