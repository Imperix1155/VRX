import { useEffect, useMemo, useState } from 'react'

import mainCss from '@renderer/assets/main.css?raw'
import { applyTheme } from '@renderer/hooks/useApplyTheme'
import './guide.css'
import { CSS_SAMPLES, JSX_SAMPLES, type CssSelector, type JsxSampleId } from './codeSamples'
import { extractCssRule, groupDesignTokens, readDesignTokens } from './cssTokens'
import {
  desktopScenes,
  drawerScenarios,
  joinScenarios,
  exploreScenarios,
  friendsScenarios,
  sourceScenarios
} from './scenarios'

declare const __APP_VERSION__: string
declare const __GUIDE_REVISION__: string

type Theme = 'dark' | 'light'
type Glow = 'off' | 'muted' | 'standard' | 'vivid'

type SceneProps = {
  name: string
  title: string
  note: string
  variant?: string
  source: string
  height?: 'short' | 'standard' | 'tall'
  paired?: boolean
  picture?: boolean
  variants?: readonly { value: string; label: string }[]
}

const nav = [
  ['start', 'Start here'],
  ['app', 'Every page'],
  ['layers', 'Layered glass'],
  ['color', 'Color and tokens'],
  ['canvas', 'Canvas and glow'],
  ['meaning', 'Meaning and state'],
  ['ladder', 'Instance labels'],
  ['type', 'Type and layout'],
  ['components', 'Controls'],
  ['overlays', 'Drawers, sheets, dialogs'],
  ['linking', 'Friends and links'],
  ['feedback', 'Loading, errors, setup'],
  ['identity', 'Identity'],
  ['donot', 'Before you ship']
] as const

const principles = [
  ['Equal platforms', 'VRChat and ChilloutVR get the same layout, fields, order, size and words.'],
  ['Brand colors', 'VRChat is blue, ChilloutVR is orange, All is the blend between them.'],
  ['Color plus a word', 'Every color has a job and a word, glyph or shape beside it.'],
  ['One exception', 'The friends-list avatar ring and dot show presence by color alone.'],
  ['Missing red, stale dim', 'Never loaded uses --error. Older data uses --text-dim.'],
  ['Layered glass', 'Canvas, panels, cards, chips: frosted panes stacked on each other.'],
  ['Privacy first', 'Ask Me and Do Not Disturb never reveal a world, anywhere.'],
  ['Simple by default', 'Few words up front. More behind ?, Show more, Settings or About.']
] as const

function Brand(): React.JSX.Element {
  return (
    <span className="design-guide__brand" role="img" aria-label="VRX">
      <span>V</span>
      <span>R</span>
      <span>X</span>
    </span>
  )
}

function Source({ children }: { children: string }): React.JSX.Element {
  return <code className="design-guide__source">{children}</code>
}

/** One rule from the shipped stylesheet, read at build time. */
function CssCode({ selector }: { selector: CssSelector }): React.JSX.Element {
  const sample = CSS_SAMPLES.find((item) => item.selector === selector)
  const rule = useMemo(() => extractCssRule(mainCss, selector), [selector])
  return (
    <figure className="design-guide__code">
      <figcaption>
        <Source>{selector}</Source>
        {sample ? <span>{sample.note}</span> : null}
      </figcaption>
      <pre>
        <code>{rule ?? `/* ${selector} is not in main.css */`}</code>
      </pre>
    </figure>
  )
}

function JsxCode({ id, title }: { id: JsxSampleId; title: string }): React.JSX.Element {
  return (
    <figure className="design-guide__code">
      <figcaption>
        <span>{title}</span>
      </figcaption>
      <pre>
        <code>{JSX_SAMPLES[id]}</code>
      </pre>
    </figure>
  )
}

function CodeGroup({
  summary,
  open = false,
  children
}: {
  summary: string
  open?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <details className="design-guide__codegroup" open={open}>
      <summary>{summary}</summary>
      <div className="design-guide__codegrid">{children}</div>
    </details>
  )
}

function isSwatch(name: string, value: string | null): boolean {
  if (value === null) return false
  if (
    /(shadow|depth|blur|filter|size|fade|space|width|inset|corner|max|tint|edge|opacity|blend)/.test(
      name
    )
  )
    return false
  if (/^--(glow|wisp)-a-/.test(name)) return false
  return /#|rgb|color-mix|gradient|var\(--/.test(value)
}

/** Every theme token from the shipped stylesheet, with a live swatch. */
function TokenTables(): React.JSX.Element {
  const groups = useMemo(() => groupDesignTokens(readDesignTokens(mainCss)), [])
  return (
    <div className="design-guide__tokens">
      {groups.map((group) => (
        <details key={group.title} open={group.title.startsWith('Canvas')}>
          <summary>
            {group.title} <span>({group.rows.length})</span>
          </summary>
          <div className="design-guide__token-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Swatch</th>
                  <th scope="col">Token</th>
                  <th scope="col">Dark</th>
                  <th scope="col">Light</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.name}>
                    <td>
                      {isSwatch(row.name, row.dark ?? row.light) ? (
                        <i
                          className="design-guide__swatch"
                          style={{ background: `var(${row.name})` }}
                        />
                      ) : null}
                    </td>
                    <td>
                      <Source>{row.name}</Source>
                    </td>
                    <td>
                      <Source>{row.dark ?? '(light only)'}</Source>
                    </td>
                    <td>
                      <Source>{row.light ?? '(same as dark)'}</Source>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  )
}

function Scene({
  name,
  title,
  note,
  variant,
  source,
  height = 'standard',
  paired = false,
  picture: initialPicture = false,
  variants
}: SceneProps): React.JSX.Element {
  const desktop = desktopScenes.includes(name)
  const [theme, setTheme] = useState<Theme>('dark')
  const [glow, setGlow] = useState<Glow>('standard')
  const [picture, setPicture] = useState(initialPicture)
  const [selectedVariant, setSelectedVariant] = useState(variant ?? variants?.[0]?.value)
  const srcFor = (frameTheme: Theme): string => {
    const params = new URLSearchParams({ scene: name, theme: frameTheme, glow })
    if (selectedVariant) params.set('variant', selectedVariant)
    if (picture) params.set('picture', '1')
    return `./glass.html?${params.toString()}`
  }
  const src = srcFor(theme)
  const other: Theme = theme === 'dark' ? 'light' : 'dark'

  return (
    <figure
      className={`design-guide__scene design-guide__scene--${height}${paired ? ' design-guide__scene--paired' : ''}${desktop ? ' design-guide__scene--desktop' : ''}`}
    >
      <figcaption>
        <div>
          <strong>{title}</strong>
          <p>{note}</p>
        </div>
        <div className="design-guide__scene-controls" aria-label={`${title} fixture controls`}>
          <a className="design-guide__standalone" href={src} target="_blank" rel="noreferrer">
            Open scene
          </a>
          <label>
            Theme
            <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
          <label>
            Glow
            <select value={glow} onChange={(event) => setGlow(event.target.value as Glow)}>
              <option value="off">Off</option>
              <option value="muted">Muted</option>
              <option value="standard">Standard</option>
              <option value="vivid">Vivid</option>
            </select>
          </label>
          <label>
            Picture
            <select
              value={picture ? 'on' : 'off'}
              onChange={(event) => setPicture(event.target.value === 'on')}
            >
              <option value="off">None</option>
              <option value="on">Sample</option>
            </select>
          </label>
          {variants && (
            <label>
              State
              <select
                value={selectedVariant}
                onChange={(event) => setSelectedVariant(event.target.value)}
              >
                {variants.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </figcaption>
      {desktop && (
        <p className="design-guide__note">
          Desktop sample at the minimum supported window size, 900×670. Scroll the frame sideways
          when the guide is narrow, or open the scene.
        </p>
      )}
      <div className="design-guide__frame-grid">
        <div className="design-guide__frame-wrap">
          <span className="design-guide__frame-label">{theme}</span>
          <iframe loading="lazy" title={`${title}, ${theme} fixture`} src={`${src}&render=1`} />
        </div>
        {paired && (
          <div className="design-guide__frame-wrap">
            <span className="design-guide__frame-label">{other}</span>
            <iframe
              loading="lazy"
              title={`${title}, ${other} fixture`}
              src={`${srcFor(other)}&render=1`}
            />
          </div>
        )}
      </div>
      <details>
        <summary>Component source</summary>
        <p>
          {source.split(' · ').map((path, index) => (
            <span key={path}>
              {index > 0 ? ' · ' : ''}
              <a
                href={`https://github.com/Imperix1155/VRX/tree/${__GUIDE_REVISION__}/${
                  path.startsWith('build/') || path.startsWith('docs/')
                    ? path
                    : `src/renderer/src/${path.includes('/') ? path : `components/${path}`}`
                }`}
              >
                <Source>{path}</Source>
              </a>
            </span>
          ))}{' '}
          at {__GUIDE_REVISION__.slice(0, 7)}. A local sample: no account, credentials, or network
          data.
        </p>
      </details>
    </figure>
  )
}

function Section({
  id,
  kicker,
  title,
  rule,
  children
}: {
  id: string
  kicker: string
  title: string
  /** The DESIGN.md section this one illustrates. */
  rule: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section id={id} className="design-guide__section glass">
      <p className="design-guide__kicker">
        {kicker} <span className="design-guide__rule">DESIGN.md {rule}</span>
      </p>
      <h2>{title}</h2>
      {children}
    </section>
  )
}

export default function Guide(): React.JSX.Element {
  const [guideTheme, setGuideTheme] = useState<Theme>('dark')
  useEffect(() => applyTheme(guideTheme, false), [guideTheme])
  useEffect(() => {
    document.body.dataset.guide = 'true'
    return () => {
      delete document.body.dataset.guide
    }
  }, [])

  return (
    <div className="design-guide" data-guide-theme={guideTheme}>
      <a className="design-guide__skip" href="#start">
        Skip navigation
      </a>
      <aside className="design-guide__sidebar glass" aria-label="Guide navigation">
        <a className="design-guide__home" href="#start">
          <Brand />
          <span>Design guide</span>
        </a>
        <label className="design-guide__theme">
          Guide theme{' '}
          <select
            value={guideTheme}
            onChange={(event) => setGuideTheme(event.target.value === 'light' ? 'light' : 'dark')}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
        <nav>
          {nav.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>
        <p className="design-guide__revision">
          VRX {__APP_VERSION__}
          <br />
          Source {__GUIDE_REVISION__.slice(0, 7)}
        </p>
      </aside>

      <main className="design-guide__main">
        <header id="start" className="design-guide__intro glass">
          <span id="current" className="design-guide__alias" />
          <p className="design-guide__kicker">VRX interface guide</p>
          <h1>Layered glass over an aurora</h1>
          <p>
            VRX shows VRChat and ChilloutVR side by side with equal weight. Its look is frosted
            glass panes stacked over a dark canvas with a blue glow in one corner and an orange glow
            in the other. Everything on this page is the real app: production components, the
            shipped stylesheet and translations, with invented sample data.
          </p>
          <p>
            Each section shows the rule, the live example, and the code behind it. The code comes
            straight from <Source>main.css</Source> and the components, so it can&apos;t drift. The
            full written rules, every token value, and copy-ready recipes are in{' '}
            <Source>docs/DESIGN.md</Source>; hand that file to an agent and it has everything it
            needs.
          </p>
          <div className="design-guide__rules design-guide__rules--four">
            {principles.map(([title, text]) => (
              <p key={title}>
                <b>{title}</b>
                <span>{text}</span>
              </p>
            ))}
          </div>
          <p className="design-guide__status">
            <span aria-hidden="true">●</span> Dark is the stylesheet baseline. Light uses the same
            layout, names, and controls. Every frame has its own Theme, Glow and Picture choice.
          </p>
        </header>

        <Section id="app" kicker="01 · every page" title="The app, page by page" rule="§8–§9">
          <p className="design-guide__lead">
            Start here when checking hierarchy. Each page is the real view inside the real shell:
            sidebar, top bar with the VRC / ALL / CVR filter and counts, and the page content on its
            panel.
          </p>
          <Scene
            name="dashboard"
            title="Dashboard"
            note="Statistics, then Wearing now and Latest invites side by side, then Popular now and Hot Instances. The first of those two uses picture cards; the second uses bars with the picture behind them."
            source="DashboardView.tsx · DashboardGlance.tsx · HotInstanceCard.tsx · ExploreWorldCard.tsx"
            variant="ready"
            variants={[
              { value: 'ready', label: 'Popular now first' },
              { value: 'hot-first', label: 'Hot Instances first' },
              { value: 'reordered', label: 'Sections moved' },
              { value: 'needs-code', label: 'VRChat needs a code' }
            ]}
            height="tall"
            paired
          />
          <Scene
            name="hot"
            title="Hot Instances"
            note="Every hot instance as a picture card, most friends first, with the same header and sheet as the Dashboard."
            source="HotInstancesView.tsx · HotInstanceCard.tsx · HotInstancesHeader.tsx"
            height="tall"
          />
          <Scene
            name="friends"
            title="Friends"
            note="The list sits on a frosted back panel. Section headers, search and every row are their own glass layer; rails and pills are chips on top. Failure states name the platform that could not refresh."
            source="FriendsList.tsx · FriendsSourceNotice.tsx · Avatar.tsx"
            variants={friendsScenarios}
            height="tall"
            paired
          />
          <Scene
            name="activity"
            title="Activity"
            note="Friends coming online, joining worlds and going offline, newest first. One row layout for both platforms, the platform named in a fixed-width pill. Ask Me and Do Not Disturb rows never name a world."
            source="ActivityView.tsx · queries/activity.ts"
            height="tall"
            variant="ready"
            variants={[
              { value: 'ready', label: 'With activity' },
              { value: 'empty', label: 'Nothing yet' }
            ]}
          />
          <Scene
            name="inbox"
            title="Inbox"
            note="Invites and friend requests from both platforms in one list. A friend request has Accept, its row's one filled button, and quiet Decline and Hide."
            source="InboxView.tsx · utils/friendActions.ts"
            height="tall"
            variant="ready"
            variants={[
              { value: 'ready', label: 'With rows' },
              { value: 'empty', label: 'Empty' }
            ]}
          />
          <Scene
            name="explore"
            title="Explore"
            note="Popular now, New, Recently updated and Favorites. Both platforms use the same world card and sheet. Try View rooms, Worlds shown, and the source states."
            source="ExploreView.tsx · ExploreWorldCard.tsx · ExploreWorldSheet.tsx"
            height="tall"
            variant="ready"
            variants={exploreScenarios}
          />
          <Scene
            name="search"
            title="Search"
            note="People and worlds from both platforms, alternating so neither leads. Search sends only on Enter or the button."
            source="SearchView.tsx · CommunityParts.tsx · WorldResults.tsx"
            height="tall"
          />
          <Scene
            name="groups"
            title="Groups"
            note="Cards wider than tall: the group's banner across the top with its icon in the corner, then the name and a VRC or CVR chip."
            source="GroupsView.tsx · CommunityParts.tsx · CommunitySheet.tsx"
            height="tall"
          />
          <Scene
            name="avatars"
            title="Avatars"
            note="The avatars uploaded on each platform and the one worn now, as picture cards with a platform chip."
            source="AvatarsView.tsx · AvatarCard.tsx · AvatarSheet.tsx"
            height="tall"
          />
          <Scene
            name="settings"
            title="Settings"
            note="Six categories, each fitting the default window without scrolling. The page sits on a frosted panel and each setting is a compact layered card. Try Appearance (theme, glow, Choose picture), Dashboard (Sections), Behavior (collapsing parent cards) and About."
            source="SettingsView.tsx · DashboardSectionsCard.tsx · PickedFriendsDialog.tsx"
            variants={[
              { value: 'ready', label: 'Ready' },
              { value: 'save-error', label: 'Save error' },
              { value: 'read-error', label: 'Could not read' },
              { value: 'picked-alerts', label: 'Picked-friend alerts' }
            ]}
            height="tall"
          />
        </Section>

        <Section id="layers" kicker="02 · material" title="Layered glass" rule="§3">
          <span id="glass" className="design-guide__alias" />
          <p className="design-guide__lead">
            The interface is one material in layers. The canvas (a picture or the aurora) is at the
            bottom. Back panels and sheets frost it. Cards and rows are their own frosted pane on
            the panel. Pills, badges and rails are glossy chips on the cards. Menus and dialogs are
            opaque so their meaning never changes with the background. Words that must be read, such
            as names and custom status messages, stay plain text and never become chips.
          </p>
          <Scene
            name="layers"
            title="The five layers"
            note="Static sample over a busy local picture. Each pane is labeled with its production class. Switch the theme and glow to see each layer keep its words readable."
            source="assets/main.css · PlatformPill.tsx · InstancePill.tsx · Avatar.tsx"
            height="tall"
            paired
          />
          <CodeGroup summary="Code: the material classes, from main.css" open>
            <CssCode selector=".glass" />
            <CssCode selector=".glass::before" />
            <CssCode selector=".glass-panel::after, .glass-sheet::after" />
            <CssCode selector=".glass-sheet::after" />
            <CssCode selector=".glass-layer" />
            <CssCode selector=".glass-chip" />
            <CssCode selector=".glass-chip::after" />
            <CssCode selector=".glass-information" />
            <CssCode selector=".glass-frosted-heavy" />
          </CodeGroup>
          <CodeGroup summary="Code: rows and cards that carry a platform or a setting">
            <CssCode selector=".platform-row" />
            <CssCode selector=".platform-row--vrx" />
            <CssCode selector=".tint-vrc" />
            <CssCode selector=".setting-card" />
          </CodeGroup>
          <CodeGroup summary="Code: stacking the layers in a component">
            <JsxCode id="layers" title="JSX" />
          </CodeGroup>
          <p className="design-guide__note">
            Never put a <Source>backdrop-filter</Source> on an element that contains a fixed
            overlay: it becomes the overlay&apos;s containing block. That is why panels and sheets
            blur on an <Source>::after</Source> layer.
          </p>
          <Scene
            name="materials"
            title="Glass over a busy picture"
            note="Interactive fixture. Open View rooms to compare the layered card with the frosted sheet over detailed local artwork."
            source="assets/main.css · ExploreWorldCard.tsx · ExploreWorldSheet.tsx"
            paired
          />
        </Section>

        <Section id="color" kicker="03 · color" title="Every color has a job" rule="§2, Appendix A">
          <p className="design-guide__lead">
            Colors are CSS variables. Dark is <Source>:root</Source>; light overrides the same names
            under <Source>[data-theme=&apos;light&apos;]</Source>. Blue means VRChat, orange means
            ChilloutVR, and every other hue has one meaning too. These tables are read from the
            shipped stylesheet, and each swatch is drawn in the guide theme chosen at the top left.
          </p>
          <div className="design-guide__rules">
            <p>
              <b>Text</b>
              <span>
                --text for anything that must be read, --text-dim for labels and notices,
                --text-faint only for placeholders, disabled controls and IDs.
              </span>
            </p>
            <p>
              <b>Light is not inverted dark</b>
              <span>
                White cards on a gray canvas. Brand colors stay full strength; words in a brand
                color use a deeper companion that clears 4.5:1.
              </span>
            </p>
            <p>
              <b>Never a raw value</b>
              <span>
                Components use var(--token) through Tailwind arbitrary values. Add a token only for
                a need no existing one meets.
              </span>
            </p>
          </div>
          <TokenTables />
        </Section>

        <Section
          id="canvas"
          kicker="04 · canvas"
          title="Aurora, scanlines, and your picture"
          rule="§4"
        >
          <span id="bg" className="design-guide__alias" />
          <span id="light" className="design-guide__alias" />
          <p className="design-guide__lead">
            The canvas is a blue glow top-left and an orange glow bottom-right over the base color,
            with faint scanlines. Background glow has four levels; Standard is the default. People
            can put their own picture behind the app with a fade; the glass shows it blurred and
            information surfaces keep their colors.
          </p>
          <Scene
            name="dashboard"
            title="Dashboard over a background picture"
            note="Interactive fixture with the sample picture on. Compare glow levels, and the light theme, where words on the canvas get a small crisp backing instead of a glow."
            source="AppBackdrop.tsx · hooks/useApplyGlow.ts · assets/main.css"
            variant="ready"
            picture
            height="tall"
            paired
          />
          <CodeGroup summary="Code: canvas, glow and picture, from main.css">
            <CssCode selector="body::before" />
            <CssCode selector="body::after" />
            <CssCode selector="[data-glow='vivid']" />
            <CssCode selector=".app-backdrop::after" />
            <CssCode selector="[data-theme='light'][data-app-background] .canvas-text:not(:empty)" />
            <JsxCode id="theme" title="Theme and glow" />
          </CodeGroup>
        </Section>

        <Section
          id="meaning"
          kicker="05 · meanings"
          title="Keep presence, intent, and access separate"
          rule="§5"
        >
          <span id="channels" className="design-guide__alias" />
          <p className="design-guide__lead">
            Presence and VRChat status are separate inputs. The avatar ring shows status for an
            in-game friend and presence otherwise. Its corner dot has no glyph, the one color-only
            cue in the app; the drawer spells the status out. Instance access is a worded pill.
          </p>
          <div className="design-guide__rules">
            <p>
              <b>Platform</b>
              <span>Blue or orange plus the words VRChat / VRC or ChilloutVR / CVR.</span>
            </p>
            <p>
              <b>Friend state</b>
              <span>Ring and dot, with an accessible label; the drawer writes the status.</span>
            </p>
            <p>
              <b>Access</b>
              <span>Visible instance words. Unknown, Private and Offline stay neutral.</span>
            </p>
          </div>
          <Scene
            name="semantics"
            title="Friend meaning"
            note="Static samples of the real Avatar and PolicySpacePill components."
            source="Avatar.tsx · PolicySpacePill.tsx · utils/statusRing.ts"
            paired
          />
          <p className="design-guide__note">
            There is no Ask to join. Join appears only when the joinability rules allow it. VRChat
            trust rank is quiet plain text below Notes; names stay neutral.
          </p>
        </Section>

        <Section
          id="ladder"
          kicker="06 · instances"
          title="Show the words, then the color"
          rule="§6"
        >
          <p className="design-guide__lead">
            Access pills use VRChat, per-platform or ChilloutVR wording (VRChat by default). Friend
            tiers run green to orange, group tiers are purple. The color supports the word; it never
            replaces it.
          </p>
          <Scene
            name="instances"
            title="Instance labels"
            note="Interactive fixture. All eight VRChat and nine ChilloutVR types through the production label resolver, plus the neutral Private, Offline and Unknown states."
            source="InstancePill.tsx · PolicySpacePill.tsx · utils/instancePill.ts"
            paired
          />
          <CodeGroup summary="Code: pills">
            <JsxCode id="pills" title="Usage" />
          </CodeGroup>
        </Section>

        <Section
          id="type"
          kicker="07 · type and space"
          title="Inter carries the interface. VT323 adds a small signal."
          rule="§7–§8"
        >
          <span id="shell" className="design-guide__alias" />
          <p className="design-guide__lead">
            Inter for names, labels, body text, status and help. VT323 only for the wordmark,
            section kickers and big numbers. Spacing is a 4 px scale; panels round at 20 px,
            controls at 12 px, pills at 9–10 px. The window floor is 900×670.
          </p>
          <Scene
            name="typography"
            title="Real hierarchy"
            note="The real TopBar and Dashboard, with their computed type measured live in the table."
            source="assets/main.css · TopBar.tsx · DashboardView.tsx"
          />
          <CodeGroup summary="Code: headings and numbers">
            <JsxCode id="heading" title="JSX" />
            <CssCode selector=".picture-grid" />
            <CssCode selector="body:lang(ja)" />
          </CodeGroup>
        </Section>

        <Section
          id="components"
          kicker="08 · controls"
          title="Controls say the choice in words"
          rule="§8"
        >
          <p className="design-guide__lead">
            Choices are segmented controls: radiogroups with one tab stop and arrow keys, a measured
            bubble behind the chosen label. On/Off is the same control. Buttons are quiet fills; a
            row has at most one filled action. A busy button stays focusable.
          </p>
          <Scene
            name="controls"
            title="Shared controls"
            note="Interactive fixture. Each control is the production component or class, named on the left."
            source="SegmentedControl.tsx · Toggle.tsx · NumberStepper.tsx · FavoriteStar.tsx · FinePrint.tsx · NotConnectedCard.tsx"
            height="tall"
          />
          <CodeGroup summary="Code: controls and buttons">
            <JsxCode id="segmented" title="Choices" />
            <JsxCode id="buttons" title="Buttons" />
            <CssCode selector=".favorite-star[data-on='true']" />
          </CodeGroup>
          <Scene
            name="updater"
            title="Update button"
            note="Interactive fixture. Available, downloading, downloaded, and idle are separate states. The sample keeps actions local."
            source="Sidebar.tsx · hooks/useUpdater.ts"
            variant="available"
            variants={[
              { value: 'available', label: 'Available' },
              { value: 'downloading', label: 'Downloading' },
              { value: 'downloaded', label: 'Downloaded' },
              { value: 'idle', label: 'Idle' }
            ]}
            height="short"
          />
        </Section>

        <Section
          id="overlays"
          kicker="09 · overlays"
          title="Drawers and sheets are frosted; confirmations are modal"
          rule="§3, §9.2–§9.3"
        >
          <p className="design-guide__lead">
            Friend details and the bottom sheets are non-modal glass sheets: the page behind stays
            usable, Escape and a click outside close them, and focus goes back to the opener. A
            confirmation is a heavy-frosted true modal that keeps focus inside.
          </p>
          <Scene
            name="drawer"
            title="Friend details"
            note="Interactive fixture. Compare both platforms, the status band, Where, Notes and quiet Trust, and the star and bell panels in the footer. Failure states recover through Retry."
            source="FriendDrawer.tsx · FriendAlertBell.tsx · FriendFavoriteStar.tsx · FavoriteMenu.tsx"
            variant="vrchat"
            variants={drawerScenarios}
          />
          <Scene
            name="join"
            title="Join confirmation"
            note="Interactive fixture. The heavy-frosted modal for either platform. Game open shows the note that replaces the mode choice. Confirm returns a local sample denial and cannot launch a game."
            source="JoinConfirmDialog.tsx · hooks/useJoinInstance.ts"
            variants={joinScenarios}
          />
          <CodeGroup summary="Code: overlays">
            <JsxCode id="sheet" title="Components" />
          </CodeGroup>
        </Section>

        <Section
          id="linking"
          kicker="10 · people"
          title="Linked friends stay two accounts"
          rule="§10"
        >
          <p className="design-guide__lead">
            A person links one VRChat and one ChilloutVR friend by hand. The row becomes a VRX row
            running blue into orange, and two locations split the picture on a diagonal, without
            pretending the accounts are one platform identity.
          </p>
          <Scene
            name="linked"
            title="Linked identities"
            note="Interactive fixture. Open the linked Nyx profile to inspect its account labels, shared note, Where cards, and Identities controls."
            source="FriendDrawer.tsx · LinkedDialog.tsx · LinkedWorlds.tsx"
          />
        </Section>

        <Section
          id="feedback"
          kicker="11 · feedback"
          title="Loading and failure say what happened"
          rule="§9.4"
        >
          <span id="login-persistence" className="design-guide__alias" />
          <p className="design-guide__lead">
            One Worlds loading… line while a platform loads for the first time, cards from the other
            platform stay. A refresh with cards shown is silent. Missing data is red and names its
            platform; stale data is dim. Sign-in is the password form first, with the quieter Use my
            sign-in from… button below it for both platforms.
          </p>
          <Scene
            name="feedback"
            title="Loading, empty, and error"
            note="Interactive fixture. Real component copy and local retry only."
            source="ExploreSourceState.tsx · ExploreDashboardPreview.tsx"
            variant="loading"
            variants={sourceScenarios}
          />
          <Scene
            name="login"
            title="Sign-in"
            note="Interactive fixture. Use invented text only. Submitting shows the secure-store failure message locally; nothing leaves this page."
            source="LoginScreen.tsx · components/auth"
            variants={[
              { value: 'ready', label: 'Credentials' },
              { value: 'totp', label: 'Authenticator code' },
              { value: 'email', label: 'Email code' }
            ]}
          />
          <Scene
            name="setup"
            title="Welcome setup"
            note="Interactive fixture. A brand-new install sees this first. Skip setup is a visible button on every screen before the summary; choices change only the sample settings."
            source="components/setup"
            variants={[
              { value: 'ready', label: 'Accounts connected' },
              { value: 'signed-out', label: 'Signed out' },
              { value: 'save-error', label: 'Save error' }
            ]}
          />
        </Section>

        <Section id="identity" kicker="12 · identity" title="The VRX mark" rule="§1">
          <p className="design-guide__lead">
            Inside the app the brand is the horizontal VT323 wordmark: blue V, silver R, orange X.
            The launcher icon sets the same letters as glass on a frosted chat bubble, with V and X
            at equal size over the R, so neither platform outweighs the other.
          </p>
          <Scene
            name="icons"
            title="App icon and small sizes"
            note="Static sample. The packaged PNGs, with a small optical drawing at 24 pixels and a pixel drawing at 16. Grayscale is in the standalone scene controls."
            source="build/icon.svg · build/icon-16.svg · build/icon-24.svg · docs/APP-ICON.md"
            height="short"
            paired
          />
        </Section>

        <Section id="donot" kicker="13 · before you ship" title="Contributor checks" rule="§12">
          <ul className="design-guide__checklist">
            <li>Reuse the component, class and token that already exist. No raw colors.</li>
            <li>Pick the right glass layer; keep names and custom status as plain text.</li>
            <li>Put a word, glyph or shape beside every color. Treat both platforms the same.</li>
            <li>Look at dark and light, every glow level, with and without a picture.</li>
            <li>Check 900×670, Japanese, keyboard focus, reduced motion, High Contrast.</li>
            <li>Cover loading, empty, error, stale and disabled states the change can reach.</li>
            <li>Keep the screen short; put extra words behind ? or Show more.</li>
            <li>Label a proposal as a proposal. Never document it as shipped.</li>
            <li>
              Update <Source>docs/DESIGN.md</Source> and this guide in the same change. Token edits
              run <Source>npm run design:tokens</Source>.
            </li>
          </ul>
          <p className="design-guide__note">
            The renderer is the source of truth. This guide is a local review tool, not proof of a
            live account, a packaged install, or platform behavior.
          </p>
        </Section>
      </main>
    </div>
  )
}
