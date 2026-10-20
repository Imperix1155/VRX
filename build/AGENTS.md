# Build assets

## Purpose

Own committed application icon sources, generated platform icons, and packaging
resources. The root contract still controls security and release authority.

## Ownership

- `icon.svg`, `icon-16.svg`, and `icon-24.svg` are the approved editable masters.
- `icon.png`, `icon.ico`, and `icon.icns` are generated build inputs. Matching
  runtime and tray images live in `resources/`.
- `entitlements.mac.plist` is the existing macOS packaging resource. Icon work
  does not authorize changing entitlements or signing policy.

## Local Contracts

Preserve the one-row VRX layout (blue V, silver R, orange X at equal size, so
neither platform outweighs the other), clipped glass case, colored rails, and
softened chamfer joins. Keep transparent outer corners and the dedicated small
letter drawings. The maintenance procedure and output map live in
[`docs/APP-ICON.md`](../docs/APP-ICON.md).

## Work Guidance

Edit the SVG masters, then run `npm run icons:generate`. Commit the sources and
outputs together. Do not hand-edit binary containers or replace the small
variants with a reduction of the large PNG. Keep this workflow portable.

## Verification

Run `npm run icons:check` and the focused icon, tray, package-file, and Linux
packaging tests in the maintenance guide. Apply the root gate for build/runtime
changes. A decoded file or browser sample does not prove a native launcher.

## Child DOX Index

No children.
