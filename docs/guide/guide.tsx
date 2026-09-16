import { useEffect, useMemo, useState } from 'react'

import { applyTheme } from '@renderer/hooks/useApplyTheme'
import './guide.css'
import { desktopScenes, drawerScenarios, exploreScenarios, sourceScenarios } from './scenarios'

declare const __APP_VERSION__: string
declare const __GUIDE_REVISION__: string

type Theme = 'dark' | 'light'
type Glow = 'muted' | 'standard' | 'vivid'

type SceneProps = {
  name: string
  title: string
  note: string
  variant?: string
  source: string
  height?: 'short' | 'standard' | 'tall'
  paired?: boolean
  variants?: readonly { value: string; label: string }[]
}

const nav = [
  ['current', 'Current app'],
  ['identity', 'Identity'],
  ['color', 'Tokens and materials'],
  ['channels', 'Meaning and state'],
  ['ladder', 'Instance schemes'],
  ['type', 'Type and layout'],
  ['components', 'Controls and sheets'],
  ['linking', 'Friends and links'],
  ['feedback', 'Loading and errors'],
  ['donot', 'Contributor checks']
] as const

function Brand(): React.JSX.Element {
  return (
    <span className="design-guide__brand" aria-label="VRX">
      <span>V</span>
      <span>R</span>
      <span>X</span>
    </span>
  )
}

function Source({ children }: { children: string }): React.JSX.Element {
  return <code className="design-guide__source">{children}</code>
}

function Scene({
  name,
  title,
  note,
  variant,
  source,
  height = 'standard',
  paired = false,
  variants
}: SceneProps): React.JSX.Element {
  const desktop = desktopScenes.includes(name)
  const [theme, setTheme] = useState<Theme>('dark')
  const [glow, setGlow] = useState<Glow>('standard')
  const [selectedVariant, setSelectedVariant] = useState(variant ?? variants?.[0]?.value)
  const src = useMemo(() => {
    const params = new URLSearchParams({ scene: name, theme, glow })
    if (selectedVariant) params.set('variant', selectedVariant)
    return `./glass.html?${params.toString()}`
  }, [glow, name, selectedVariant, theme])
  const alternateSrc = useMemo(() => {
    const params = new URLSearchParams({
      scene: name,
      theme: theme === 'dark' ? 'light' : 'dark',
      glow
    })
    if (selectedVariant) params.set('variant', selectedVariant)
    return `./glass.html?${params.toString()}`
  }, [glow, name, selectedVariant, theme])

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
              <option value="muted">Muted</option>
              <option value="standard">Standard</option>
              <option value="vivid">Vivid</option>
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
          Desktop sample at the minimum supported app window size. Scroll the frame sideways when
          the guide is narrow, or open the scene.
        </p>
      )}
      <div className="design-guide__frame-grid">
        <div className="design-guide__frame-wrap">
          <span className="design-guide__frame-label">{theme}</span>
          <iframe loading="lazy" title={`${title}, ${theme} fixture`} src={`${src}&render=1`} />
        </div>
        {paired && (
          <div className="design-guide__frame-wrap">
            <span className="design-guide__frame-label">{theme === 'dark' ? 'light' : 'dark'}</span>
            <iframe
              loading="lazy"
              title={`${title}, ${theme === 'dark' ? 'light' : 'dark'} fixture`}
              src={`${alternateSrc}&render=1`}
            />
          </div>
        )}
      </div>
      <details>
        <summary>Fixture source</summary>
        <p>
          {source.split(' · ').map((path, index) => (
            <span key={path}>
              {index > 0 ? ' · ' : ''}
              <a
                href={`https://github.com/Imperix1155/VRX/tree/${__GUIDE_REVISION__}/src/renderer/src/${path.includes('/') ? path : `components/${path}`}`}
              >
                <Source>{path}</Source>
              </a>
            </span>
          ))}{' '}
          at {__GUIDE_REVISION__.slice(0, 7)}. This is a local synthetic fixture. It does not use an
          account, credentials, or network data.
        </p>
      </details>
    </figure>
  )
}

function Section({
  id,
  kicker,
  title,
  children
}: {
  id: string
  kicker: string
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section id={id} className="design-guide__section glass">
      <p className="design-guide__kicker">{kicker}</p>
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
      <a className="design-guide__skip" href="#current">
        Skip navigation
      </a>
      <aside className="design-guide__sidebar glass" aria-label="Guide navigation">
        <a className="design-guide__home" href="#current">
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
        <header id="current" className="design-guide__intro glass">
          <span id="identity" className="design-guide__alias" />
          <p className="design-guide__kicker">VRX interface guide</p>
          <h1>The VRX visual language</h1>
          <p>
            Liquid glass, an aurora canvas, and restrained retro type. VRX gives VRChat and
            ChilloutVR equal importance, with the same words and controls for equivalent concepts.
            These are real app components using local sample data.
          </p>
          <p className="design-guide__status">
            <span aria-hidden="true">●</span> Dark is the default. Light uses the same layout,
            names, and controls.
          </p>
        </header>

        <Section id="app" kicker="01 · current app" title="The app, assembled">
          <p className="design-guide__lead">
            Start here when checking hierarchy. Stats, Popular now, and Hot Instances each keep
            their own state instead of collapsing into a single empty dashboard. The section
            headings share subdued gray text at normal weight, with their existing sizes.
          </p>
          <Scene
            name="dashboard"
            title="Dashboard"
            note="Interactive fixture. The composition includes statistics, discovery, and hot instances."
            source="DashboardView.tsx"
            height="tall"
            paired
          />
          <Scene
            name="explore"
            title="Explore worlds and rooms"
            note="Interactive fixture. Both platforms use the same card. Open View rooms, change Worlds shown, and inspect per-platform loading and failure states."
            source="ExploreView.tsx · ExploreWorldCard.tsx · ExploreWorldSheet.tsx"
            height="tall"
            variant="ready"
            variants={exploreScenarios}
          />
        </Section>

        <Section id="color" kicker="02 · identity" title="Tokens give color a job">
          <span id="glass" className="design-guide__alias" />
          <span id="bg" className="design-guide__alias" />
          <span id="light" className="design-guide__alias" />
          <p className="design-guide__lead">
            Blue identifies VRChat. Orange identifies ChilloutVR. The corner glow and quiet
            scanlines make the shared space feel like VRX without competing with the information.
          </p>
          <p>
            Information cards and panels must keep their intended colors regardless of the
            background glow. Neutral sheen may vary; decorative chrome such as the sidebar may pick
            up ambient color. The current components still allow some background color bleed. Its
            correction is approved and pending verification. These examples show the current code
            without a preview-only workaround.
          </p>
          <div className="design-guide__swatches" aria-label="Token swatches">
            {[
              '--bg-base',
              '--text',
              '--text-dim',
              '--text-faint',
              '--vrc',
              '--cvr',
              '--bridge',
              '--ingame',
              '--policy-public',
              '--policy-private',
              '--active',
              '--offline',
              '--error'
            ].map((token) => (
              <div key={token}>
                <i style={{ background: `var(${token})` }} />
                <Source>{token}</Source>
              </div>
            ))}
          </div>
          <Scene
            name="materials"
            title="Glass over content"
            note="Interactive fixture. Open View rooms to compare the ordinary card with the frosted sheet over detailed local artwork."
            source="assets/main.css · ExploreWorldCard.tsx · ExploreWorldSheet.tsx"
            paired
          />
          <Scene
            name="settings"
            title="Appearance and glow"
            note="Interactive fixture. Change Theme or Background glow in the actual appearance controls. These choices last only in this sample."
            source="assets/main.css · SettingsView.tsx"
            height="short"
          />
        </Section>

        <Section
          id="channels"
          kicker="03 · meanings"
          title="Keep presence, intent, and access separate"
        >
          <p className="design-guide__lead">
            Presence and VRChat status are separate inputs. The avatar ring shows status for an
            in-game friend and presence for an active or offline friend. Its corner marker has no
            glyph. The drawer supplies written status. Instance access is the worded pill.
          </p>
          <div className="design-guide__rules">
            <p>
              <b>Platform</b>
              <span>Blue or orange plus VRC or CVR text.</span>
            </p>
            <p>
              <b>Friend state</b>
              <span>Status or presence ring and marker, with an accessible label.</span>
            </p>
            <p>
              <b>Access</b>
              <span>Visible instance words. Unknown and hidden stay neutral.</span>
            </p>
          </div>
          <Scene
            name="semantics"
            title="Friend meaning"
            note="Static samples of the real Avatar and PolicySpacePill components. The full rows and drawers appear below."
            source="FriendsList.tsx · FriendDrawer.tsx · Avatar.tsx"
            paired
          />
          <p className="design-guide__note">
            Ask to join is not an implemented VRX flow. Direct Join appears only when the current
            eligibility rules allow it. Available VRChat trust rank stays quiet plain text below
            Notes; names remain neutral. There is no row rank pill or trust-display setting.
          </p>
        </Section>

        <Section
          id="ladder"
          kicker="04 · instances"
          title="Use the selected label scheme, then show the words"
        >
          <p className="design-guide__lead">
            The pill vocabulary can use VRChat, ChilloutVR, or per-platform wording. VRChat wording
            is the default. The color supports the label. It never replaces it.
          </p>
          <Scene
            name="instances"
            title="Instance labels"
            note="Interactive fixture. All eight VRChat and nine ChilloutVR model types use the production label resolver, plus the neutral Private and Unknown states."
            source="InstancePill.tsx · PolicySpacePill.tsx · utils/instancePill.ts"
            paired
          />
          <p className="design-guide__note">
            Some CVR wire forms remain conservatively mapped; this displays the app model, not a
            claim that every upstream form is verified. Policy space is separate from access.
            Public, Private, and Unknown describe moderation context where the app has that
            information.
          </p>
        </Section>

        <Section
          id="type"
          kicker="05 · type and space"
          title="Inter carries the interface. VT323 adds a small signal."
        >
          <span id="shell" className="design-guide__alias" />
          <p className="design-guide__lead">
            Use Inter for names, labels, body text, status, and help. VT323 is reserved for the VRX
            mark, section kickers, and prominent counts. Technical IDs use a readable monospace
            face.
          </p>
          <Scene
            name="typography"
            title="Real hierarchy"
            note="Real TopBar and Dashboard components show page, section, count, card, body, and control hierarchy at their actual sizes. Open a Hot Instance for its technical identifier."
            source="assets/main.css · TopBar.tsx · DashboardView.tsx · HotInstanceSheet.tsx"
          />
          <Scene
            name="dashboard"
            title="App shell"
            note="Interactive fixture. The sidebar holds navigation while the content area owns scrolling."
            source="AppShell.tsx · Sidebar.tsx · TopBar.tsx"
            height="short"
          />
        </Section>

        <Section id="components" kicker="06 · controls" title="Controls state the choice in words">
          <p className="design-guide__lead">
            Segmented controls are radiogroups with one tab stop and arrow-key movement. The
            selection bubble measures its label. A toggle also shows its on or off position.
          </p>
          <Scene
            name="controls"
            title="Shared segmented control"
            note="Interactive fixture. The 20px glass track and 16px inset selection are deliberate, including the unequal-width labels."
            source="SegmentedControl.tsx · hooks/useSegmentedBubble.ts"
          />
          <Scene
            name="updater"
            title="Update states"
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
          <Scene
            name="drawer"
            title="Friend drawer"
            note="Interactive fixture. Compare both platforms, inspect Notes and quiet Trust, and open the real frosted drawer. Failure states recover through Retry."
            source="FriendDrawer.tsx · JoinConfirmDialog.tsx"
            variant="vrchat"
            variants={drawerScenarios}
          />
          <Scene
            name="join"
            title="Join confirmation"
            note="Interactive fixture. Open the real heavy-frosted modal. Confirm returns a local sample denial and cannot launch a game."
            source="JoinConfirmDialog.tsx"
          />
        </Section>

        <Section
          id="linking"
          kicker="07 · people"
          title="Friends stay recognizable when accounts connect"
        >
          <p className="design-guide__lead">
            Rows carry a platform tab with text as well as color. A linked person keeps their
            account details visible, then adds the local connection without pretending two accounts
            are one platform identity.
          </p>
          <Scene
            name="friends"
            title="Friends list"
            note="Interactive fixture. Rows show the real platform tab, avatar treatment, and contextual action space."
            source="FriendsList.tsx · Avatar.tsx"
            paired
          />
          <Scene
            name="linked"
            title="Linked identities"
            note="Interactive fixture. Open the linked Nyx profile to inspect its account labels, shared note, Where cards, and Identities controls."
            source="FriendDrawer.tsx · LinkedDialog.tsx"
          />
        </Section>

        <Section
          id="feedback"
          kicker="08 · feedback"
          title="Loading and failure should say what happened"
        >
          <span id="login-persistence" className="design-guide__alias" />
          <p className="design-guide__lead">
            A source can be loading, stale, empty, unavailable, or in error without hiding unrelated
            content. Login uses the same app language and never places credentials in a fixture.
          </p>
          <Scene
            name="feedback"
            title="Loading, empty, and error"
            note="Interactive fixture. These states use real component copy and local retry affordances only."
            source="ExploreSourceState.tsx · ExploreDashboardPreview.tsx"
            variant="loading"
            variants={sourceScenarios}
          />
          <Scene
            name="login"
            title="Login and secure-store feedback"
            note="Interactive fixture. Use invented text only. Submitting shows the app's secure-store failure message locally; no credentials leave this page."
            source="LoginScreen.tsx · components/auth"
            variants={[
              { value: 'ready', label: 'Credentials' },
              { value: 'totp', label: 'Authenticator code' },
              { value: 'email', label: 'Email code' }
            ]}
          />
        </Section>

        <Section id="donot" kicker="09 · contributor checks" title="Before changing a component">
          <ul className="design-guide__checklist">
            <li>Use the component and token already in the renderer when one exists.</li>
            <li>Keep dark and light as the same interface. Check both.</li>
            <li>Make platform and meaning readable without color alone.</li>
            <li>Keep a drawer frosted and a true modal heavily frosted over busy content.</li>
            <li>
              Test keyboard focus, reduced motion, loading, and error states that the change can
              reach.
            </li>
            <li>Label a proposal as a proposal. Do not document it as shipped behavior.</li>
          </ul>
          <p className="design-guide__note">
            Source truth is the renderer. This guide is a local review tool, not proof of a live
            account or external platform behavior.
          </p>
        </Section>
      </main>
    </div>
  )
}
