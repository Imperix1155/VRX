# Design-guide implementation

## Purpose

Provide human-readable design documentation with actual renderer components
and synthetic local data. `../design.html` is the guide; `../glass.html` runs
isolated component scenes. `../DESIGN.md` is the synchronized agent contract.

## Ownership

This directory owns guide-only React, fixtures, styles, and build configuration.
Production components, tokens, translations, fonts, and behavior remain owned
by `src/renderer`. Import them rather than duplicating their markup or CSS.

## Local contracts

- No real accounts, credentials, platform requests, persistence, external
  images, game launches, or updater actions. A scene must refuse a live bridge.
- Fixture actions change only synthetic memory. Keep guide controls outside
  the app examples and label static samples, interactive fixtures, and proposals.
- Dark is default. Use production theme/glow applicators and CSS in scene
  documents so both themes and overlay behavior retain their root context.
- Keep source revision and component references visible without cluttering
  examples. Known product defects remain defects, not design rules.
- Information-bearing surfaces must keep their intended colors independent of
  the ambient background. Import the production information backing and never
  hide remaining gaps with guide-only styles. Decorative chrome may retain
  ambient color. Source checks do not establish installed-app visual acceptance.
- Preserve the app's 900×670 floor in embedded desktop examples and standalone
  scenes. Let the guide scroll around that window; never shrink away controls.
- Open focus-taking overlays only after a reader gesture and restore focus to
  the opener when the guide owns the close path. Keep loading, retained
  refresh, room expiry/recovery, and note failure/retry selectable in the shared
  scenario registry. Successful synthetic reads get fresh timestamps.
- Keep seeded query data for the scene document's lifetime. Cache-only readers
  must not lose the default examples to garbage collection; do not add polling.
- Keep this code and generated guide output out of packaged app artifacts.

## Work guidance

Read the root and renderer contracts before changing imported behavior. Prefer
whole production parents for private subcomponents. Never silently redesign the
app to make a documentation example easier to construct.

## Verification

Run the documented guide typecheck/build and fixture-boundary checks, then
inspect actual browser examples with the owner's capture consent. Source and
build checks do not establish rendered fidelity. Run applicable project gates
when build configuration or production code changes.

## Child DOX index

No children.

Settings scenes import the production compact cards, On/Off controls, and dependent disclosure. Use the Dashboard shortcut and feature controls to verify reflow with the shared synthetic query data.
