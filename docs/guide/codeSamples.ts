/**
 * The code the design guide shows beside its examples. CSS samples name a
 * selector and the guide reads that rule out of the shipped `main.css` at
 * build time, so it is always the real code. JSX samples are short usage
 * snippets of production components and classes; `design-doc.test.ts` checks
 * that every selector exists and every component a snippet names is real.
 */

export interface CssSample {
  readonly selector: string
  readonly note: string
}

export const CSS_SAMPLES = [
  { selector: '.glass', note: 'Layer 1. The base skin every pane starts from.' },
  { selector: '.glass::before', note: 'The sheen lights the pane, under its content.' },
  {
    selector: '.glass-panel::after, .glass-sheet::after',
    note: 'Layer 2. Back panels and sheets blur on a layer under the content.'
  },
  { selector: '.glass-sheet::after', note: 'Sheets take the heavier frost.' },
  { selector: '.glass-layer', note: 'Layer 3. Cards, rows, headers and fields.' },
  { selector: '.platform-row', note: 'Layer 3 for one platform: tint, edge and a 3 px bar.' },
  { selector: '.platform-row--vrx', note: 'A linked person runs blue into orange.' },
  { selector: '.setting-card', note: 'A Settings row on the frosted Settings panel.' },
  { selector: '.glass-chip', note: 'Layer 4. Pills, badges, rails and counts.' },
  { selector: '.glass-chip::after', note: 'The chip’s glossy top light, under its word.' },
  { selector: '.glass-information', note: 'Opaque backing for menus, dialogs and setup.' },
  { selector: '.glass-frosted-heavy', note: 'Add for a true confirmation modal.' },
  { selector: '.tint-vrc', note: 'A platform tint sets the image only.' },
  { selector: 'body::before', note: 'The aurora: blue top-left, orange bottom-right.' },
  { selector: 'body::after', note: 'Scanlines: a faint texture, never a grid.' },
  { selector: "[data-glow='vivid']", note: 'A glow level only changes variables.' },
  { selector: '.app-backdrop::after', note: 'The fade over a background picture.' },
  {
    selector: "[data-theme='light'][data-app-background] .canvas-text:not(:empty)",
    note: 'Words on a light-theme picture get a crisp backing, never a glow.'
  },
  { selector: '.picture-grid', note: 'Picture cards: two across from 440 px.' },
  { selector: 'body:lang(ja)', note: 'Japanese wraps at phrase boundaries.' },
  {
    selector: ".favorite-star[data-on='true']",
    note: 'The filled star is the cue, yellow the echo.'
  }
] as const satisfies readonly CssSample[]

export type CssSelector = (typeof CSS_SAMPLES)[number]['selector']

/** Usage snippets for production components and classes. */
export const JSX_SAMPLES = {
  layers: `{/* Layer 2: the back panel a page sits on */}
<section className="glass glass-panel p-[var(--space-4)]">
  {/* Layer 3: a card */}
  <div className="glass glass-layer p-[16px_18px]">…</div>
  {/* Layer 3 for one platform */}
  <div className="platform-row platform-row--vrchat flex items-center gap-[var(--space-3)] p-[var(--space-2)]">
    <span className="flex-1 truncate text-[13px] text-[var(--text)]">Amy</span>
    {/* Layer 4: chips */}
    <PlatformPill platform="vrchat" />
    <InstancePill label={t(pill.labelKey)} tier={pill.tier} />
  </div>
</section>

{/* Menus and dialogs stay opaque */}
<div role="dialog" className="glass glass-frosted-heavy glass-information p-[var(--space-6)]">…</div>`,
  pills: `const pill = instancePillFor(friend.instance, labelScheme)
<InstancePill label={t(pill.labelKey)} tier={pill.tier} />
<PlatformPill platform="chilloutvr" />
<PolicySpacePill space={policySpaceFor(friend.platform, friend.instance)} />`,
  segmented: `<SegmentedControl
  values={['vrchat', 'platform-native', 'chilloutvr'] as const}
  active={scheme}
  labelKeys={LABEL_KEYS}
  ariaLabel={t('settings.labelScheme.label')}
  onChange={setScheme}
/>
<Toggle checked={on} onChange={setOn} ariaLabel={t('settings.dashboard.popular.label')} />
<NumberStepper value={threshold} min={1} max={10} onChange={setThreshold} ariaLabel={t('dashboard.hotThresholdAria')} />`,
  buttons: `// Quiet (most buttons)
<button className="rounded-control bg-[var(--control-fill)] px-[var(--space-3)] py-[var(--space-2)] text-[12px] font-semibold text-[var(--text)] hover:bg-[var(--control-fill-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)]">
// A row's one filled action (Accept, Add friend)
<button className={FRIEND_ACTION_BUTTON}>
// Setup's secondary action
<button className={SECONDARY_BUTTON}>
// Busy or finished: stays focusable
<button aria-disabled={busy || undefined} onClick={() => { if (!busy) run() }}>`,
  heading: `<h1 className="canvas-text text-[25px] font-extrabold text-[var(--text)]">Dashboard</h1>
<h2 className="canvas-text font-[family-name:var(--font-mono)] text-[18px] font-normal tracking-[2px] uppercase text-[var(--text-dim)]">
  Hot Instances
</h2>
<div className="font-[family-name:var(--font-mono)] text-[38px] leading-none tabular-nums text-[var(--text)]">13</div>
<div className="mt-[var(--space-1)] text-[12.5px] text-[var(--text-dim)]">Friends online</div>`,
  theme: `applyTheme('light', false) // sets data-theme="light" on <html>
applyTheme('dark', false)  // removes it: dark is the baseline
applyGlow('vivid')         // sets data-glow; 'standard' removes it`,
  sheet: `<FriendDrawer friend={selected} onClose={close} />     // .glass .glass-sheet, non-modal
<ExploreWorldSheet snapshot={snapshot} opener={opener} … /> // bottom sheet with SheetGrabBar
<JoinConfirmDialog />                                     // heavy-frosted true modal`
} as const

export type JsxSampleId = keyof typeof JSX_SAMPLES
