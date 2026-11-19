import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SIDEBAR_PAGES } from '../src/shared/types'

// The root contract asks for README.md to change when what users see changes.
// Saved history shipped in test builds while the README still said Activity
// was "kept only while VRX is open", because nothing but memory tied the two.
// These checks tie the README's page list to the app's own lists: a new page
// or a new Activity tab fails here until the README names it, and that edit
// puts the author in front of the paragraph that describes the page.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
const en = JSON.parse(
  readFileSync(join(ROOT, 'src/renderer/src/locales/en/translation.json'), 'utf8')
)

/** The "What it does" page list: one `- **Name**: …` item per sidebar page. */
function pageItems() {
  const start = readme.indexOf('Pages, top to bottom in the sidebar:')
  const end = readme.indexOf('Across the app:')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return readme
    .slice(start, end)
    .split(/^- (?=\*\*)/m)
    .slice(1)
    .map((item) => ({ name: item.match(/^\*\*(.+?)\*\*/)?.[1], text: item }))
}

describe('README.md names what the app shows', () => {
  it('lists every sidebar page, in the sidebar’s own order', () => {
    expect(pageItems().map((item) => item.name)).toEqual(
      SIDEBAR_PAGES.map((page) => en.shell.nav[page])
    )
  })

  it('names every Activity tab in the Activity item', () => {
    const activity = pageItems().find((item) => item.name === en.shell.nav.activity)
    const tabs = Object.values(en.activity.kinds)
    expect(tabs.length).toBeGreaterThan(0)
    for (const tab of tabs) expect(activity?.text).toContain(`**${tab}**`)
  })

  it('names each way to move saved history, by its button', () => {
    const { importVrcx, backup, restore } = en.activity.transfer
    for (const button of [importVrcx, backup, restore]) {
      expect(button).toBeTruthy()
      expect(readme).toContain(`**${button}**`)
    }
  })
})
