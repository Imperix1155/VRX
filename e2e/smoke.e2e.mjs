// The smoke test: does the real app start, sign in, show friends, follow a
// live event, open every page and remember its sign-in after a restart?
//
// Unit tests prove each piece. This proves the pieces are wired together: the
// preload bridge, every IPC handler a page calls at mount, the Content
// Security Policy, the stylesheet and the built bundle. A blank window or a
// page that throws on open fails here even when every unit test passes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchVrx, removeUserData } from './app.mjs'
import { startFakePlatforms } from './fake-platforms.mjs'

/** Sidebar pages, in sidebar order, with a line each one shows when it works. */
const PAGES = [
  ['Dashboard', /^Friends online$/],
  ['Friends', /^Aria Vale$/],
  ['Hot Instances', /^Min\. friends$/],
  ['Activity', /No activity yet|Cass Nova/],
  ['Inbox', /^Nothing waiting$/],
  ['Explore', /^Popular now$/],
  ['Search', /^Press Enter to search/],
  ['Groups', /^The groups you belong to/],
  ['Avatars', /^Wearing now$/i],
  ['Settings', /^Background glow$/]
]

let fake
let vrx

beforeAll(async () => {
  fake = await startFakePlatforms()
  vrx = await launchVrx({ fakePort: fake.port, keepUserData: true })
})

afterAll(async () => {
  await vrx?.close()
  if (vrx) removeUserData(vrx.userData)
  await fake?.close()
})

const openPage = async (name) => {
  await vrx.page.getByRole('button', { name, exact: true }).first().click()
  await expect.poll(() => vrx.page.locator('h1').first().innerText()).toBe(name)
}

/** The top bar's written connection state (the dot beside it is color only). */
const waitUntilLive = () =>
  vrx.page
    .getByTestId('topbar-status')
    .getByText('VRChat: Live; ChilloutVR: Live')
    .waitFor({ state: 'attached' })

describe('VRX smoke test', () => {
  it('walks the welcome setup and signs in to both platforms', async () => {
    const { page } = vrx
    await page.getByRole('button', { name: 'Get started' }).click()

    await page.getByLabel('Username or email').fill('tester')
    await page.locator('input[type=password]').first().fill('password')
    await page.getByRole('button', { name: 'Connect' }).first().click()
    await page.getByText('Connected as Tester VRC').waitFor()

    await page.getByLabel('Email address').fill('tester@example.com')
    await page.locator('input[type=password]').last().fill('password')
    await page.getByRole('button', { name: 'Connect' }).last().click()
    await page.getByText(/Both connected/).waitFor()

    // Pages, Dashboard, Alerts, Look, then the summary's "Open VRX". The
    // loop presses Continue until that button shows, however many steps the
    // setup has, and says so plainly if it never does.
    const open = page.getByRole('button', { name: 'Open VRX' })
    for (let step = 0; (await open.count()) === 0; step++) {
      if (step === 12) throw new Error('the welcome setup never reached "Open VRX"')
      await page.getByRole('button', { name: 'Continue' }).click()
    }
    await open.click()
    await page.getByRole('heading', { name: 'Dashboard' }).waitFor()
  })

  it('connects both live feeds and shows friends from both platforms', async () => {
    const { page } = vrx
    await expect
      .poll(() => fake.sockets(), { timeout: 30_000 })
      .toEqual({ vrchat: 1, chilloutvr: 1 })
    await waitUntilLive()

    await openPage('Friends')
    await page.getByText('Aria Vale').first().waitFor() // VRChat
    await page.getByText('Gale Wind').first().waitFor() // ChilloutVR
  })

  it('moves a friend when a live event arrives, without a refresh', async () => {
    const { page } = vrx
    await openPage('Friends')
    await page.getByText('Aria Vale').first().waitFor()
    // Cass Nova starts offline, so the collapsed Offline section hides her.
    expect(await page.getByText('Cass Nova').count()).toBe(0)
    const cass = fake.state().vrc.friends.find((friend) => friend.displayName === 'Cass Nova')
    fake.setVrcFriend({ id: cass.id, state: 'online', location: 'private', status: 'active' })
    await page.getByText('Cass Nova').first().waitFor()
  })

  it('opens friend details', async () => {
    const { page } = vrx
    await openPage('Friends')
    await page.getByText('Aria Vale').first().click()
    const close = page.locator('[data-drawer-close]')
    await close.waitFor()
    await close.click()
  })

  it.each(PAGES)('opens the %s page', async (name, proof) => {
    await openPage(name)
    await vrx.page.getByText(proof).first().waitFor()
  })

  it('asked the platforms to change nothing', () => {
    // Looking around must never write. A write is a user's explicit press.
    expect(fake.state().writes).toEqual([])
  })

  it('shows room details and rates a world: one request to like, one to clear', async () => {
    const { page } = vrx
    const sheet = page.getByRole('dialog')
    const close = sheet.getByRole('button', { name: 'Close', exact: true })
    // A retry may find the sheet still open from the first try.
    if (await sheet.count()) await close.click()
    await openPage('Explore')
    await page.getByRole('button', { name: 'Sunset Lounge on VRChat. View rooms' }).click()
    // The world's rooms load into the sheet, with what a room says about itself.
    await sheet.getByRole('button', { name: 'Join', exact: true }).first().waitFor()
    await sheet.getByText('Friday Hangout').waitFor()
    await sheet.getByText('Everyone is welcome.').waitFor()
    await sheet.getByText(/Language: .*Portuguese/).waitFor() // the fake sends pt-BR
    await sheet.getByText('Hangout · adventure').waitFor()

    const like = sheet.getByRole('button', { name: 'Like Sunset Lounge', exact: true })
    const liked = sheet.getByRole('button', { name: /^Liked\. Clear your rating/ })
    // A rating button is switched off until VRX has the platform's answer.
    const answered = (button) => expect.poll(() => button.isEnabled()).toBe(true)
    // VRX refuses a second rating change within a second of the first
    // (WORLD_RATING_WRITE_SPACING_MS), and nothing on screen says when that
    // second is over. So this waits for the answer, then a little over a
    // second. It is the one fixed wait in this file.
    const readyForNextChange = async (button) => {
      await answered(button)
      await page.waitForTimeout(1_100)
    }

    // A retry may find the world still liked by the first try: clear it.
    await like.or(liked).waitFor()
    if (await liked.count()) {
      await readyForNextChange(liked)
      await liked.click()
      await like.waitFor()
      await readyForNextChange(like)
    }
    await answered(like)
    const before = fake.state().writes.length
    const sent = () =>
      fake
        .state()
        .writes.slice(before)
        .map((write) => `${write.kind} ${write.value ?? ''}`.trim())

    await like.click()
    await liked.waitFor()
    expect(await liked.getAttribute('aria-pressed')).toBe('true')
    // The button shows the choice at once. The request follows.
    await expect.poll(sent).toEqual(['world-rating like'])

    // Pressing the active choice clears it.
    await readyForNextChange(liked)
    await liked.click()
    await like.waitFor()
    expect(await like.getAttribute('aria-pressed')).toBe('false')
    await expect.poll(sent).toEqual(['world-rating like', 'world-rating-clear'])

    await close.click()
    await sheet.waitFor({ state: 'detached' })
  })

  it('offers Try again when a rating cannot be read, and one press reads it', async () => {
    const { page } = vrx
    const sheet = page.getByRole('dialog')
    const close = sheet.getByRole('button', { name: 'Close', exact: true })
    if (await sheet.count()) await close.click()
    await openPage('Explore')
    const writes = fake.state().writes.length
    // The fake platform fails the next rating read, once.
    fake.state().mode.vrcRatingReadFails = 1
    await page.getByRole('button', { name: 'Quiet Library on VRChat. View rooms' }).click()

    await sheet.getByText("Couldn't load your rating.").waitFor()
    const like = sheet.getByRole('button', { name: 'Like Quiet Library', exact: true })
    expect(await like.isDisabled()).toBe(true)
    // One read used up the one failure. Had VRX read again on its own, that
    // second read would have worked and the line above would never show.
    expect(fake.state().mode.vrcRatingReadFails).toBe(0)

    await sheet.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect.poll(() => like.isEnabled()).toBe(true)
    expect(await sheet.getByText("Couldn't load your rating.").count()).toBe(0)
    // Reading is not a change: nothing was asked of the platform.
    expect(fake.state().writes.length).toBe(writes)

    await close.click()
    await sheet.waitFor({ state: 'detached' })
  })

  it('starts each game from Quick launch with its own Steam link, asking the platforms nothing', async () => {
    const { page, app } = vrx
    await openPage('Dashboard')
    // A test must never start a real game: record the link instead of opening
    // it, and answer "Steam is installed" where VRX checks first (Windows).
    await app.evaluate(({ app, shell }) => {
      globalThis.vrxE2eOpened = []
      shell.openExternal = async (url) => {
        globalThis.vrxE2eOpened.push(url)
      }
      app.getApplicationNameForProtocol = () => 'Steam'
    })
    const opened = () => app.evaluate(() => globalThis.vrxE2eOpened)
    const writes = () => JSON.stringify(fake.state().writes)

    // One button per signed-in platform, between the numbers and the sections.
    const vrchat = page.getByRole('button', { name: 'Launch VRChat', exact: true })
    const chilloutvr = page.getByRole('button', { name: 'Launch ChilloutVR', exact: true })
    await vrchat.waitFor()
    await chilloutvr.waitFor()
    const before = writes()

    await vrchat.click()
    await page.getByRole('button', { name: 'Starting VRChat…', exact: true }).waitFor()
    await expect.poll(opened).toEqual(['steam://rungameid/438100'])
    // A second press while it starts opens nothing more.
    await page.getByRole('button', { name: 'Starting VRChat…', exact: true }).click()

    await chilloutvr.click()
    await page.getByRole('button', { name: 'Starting ChilloutVR…', exact: true }).waitFor()
    await expect.poll(opened).toEqual(['steam://rungameid/438100', 'steam://rungameid/661130'])
    // Starting a game is local: neither platform was asked to change anything.
    expect(writes()).toBe(before)
  })

  it('drags a sidebar page and a Dashboard section into a new order', async () => {
    const { page } = vrx
    await openPage('Dashboard')
    const nav = page.getByRole('navigation', { name: 'Main navigation' })
    const pages = () => nav.getByRole('button').allInnerTexts()
    expect((await pages()).slice(0, 3)).toEqual(['Dashboard', 'Friends', 'Hot Instances'])

    // A right-click offers the one-item menu; picking it starts reorder mode.
    await nav.getByRole('button', { name: 'Friends', exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Reorder' }).click()

    // Drag Friends below Hot Instances.
    const friends = await nav.getByRole('button', { name: 'Friends', exact: true }).boundingBox()
    const x = friends.x + friends.width / 2
    const y = friends.y + friends.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + 20, { steps: 4 })
    await page.mouse.move(x, y + friends.height, { steps: 4 })
    await page.mouse.up()
    await expect
      .poll(async () => (await pages()).slice(0, 3))
      .toEqual(['Dashboard', 'Hot Instances', 'Friends'])
    // Settings never moves and the drag opened no page.
    expect((await pages()).at(-1)).toBe('Settings')
    expect(await page.locator('h1').first().innerText()).toBe('Dashboard')

    // The Dashboard shows its sections as a short list; move the last one up
    // with the keyboard.
    const sections = page.locator('[data-dashboard-reorder] [data-reorder-item]')
    expect(await sections.allInnerTexts()).toEqual([
      'Quick launch',
      'Wearing now',
      'Latest invites',
      'Popular now',
      'Hot Instances'
    ])
    await sections.nth(4).focus()
    await page.keyboard.press('ArrowUp')
    await expect.poll(async () => (await sections.allInnerTexts()).at(3)).toBe('Hot Instances')

    // The whole page answers a right-click, the empty space under this short
    // list included: there it offers the way out. Esc folds the menu only.
    const last = await sections.nth(4).boundingBox()
    await page.mouse.click(last.x + last.width / 2, 610, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Done' }).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('menuitem', { name: 'Done' }).waitFor({ state: 'detached' })
    expect(await page.locator('[data-dashboard-reorder]').count()).toBe(1)

    // Esc in the middle of a drag puts the tile back and keeps reorder mode
    // on, and letting go afterwards opens no page.
    const explore = await nav.getByRole('button', { name: 'Explore', exact: true }).boundingBox()
    const before = await pages()
    await page.mouse.move(explore.x + explore.width / 2, explore.y + explore.height / 2)
    await page.mouse.down()
    await page.mouse.move(explore.x + explore.width / 2, explore.y - explore.height, { steps: 6 })
    await page.keyboard.press('Escape')
    await page.mouse.up()
    expect(await pages()).toEqual(before)
    expect(await page.locator('[data-dashboard-reorder]').count()).toBe(1)
    expect(await page.locator('h1').first().innerText()).toBe('Dashboard')

    await page.keyboard.press('Escape')
    await page.locator('[data-dashboard-reorder]').waitFor({ state: 'detached' })
    await page
      .getByText(/^Friends online$/)
      .first()
      .waitFor()
  })

  it('reported no error in the window', () => {
    expect(vrx.rendererErrors).toEqual([])
  })

  it('remembers both sign-ins and the saved activity after a restart', async () => {
    // Something for the Activity page to remember. A friend the app has only
    // just met is learned silently, so repeat the change until a row shows.
    await openPage('Activity')
    const cass = fake.state().vrc.friends.find((friend) => friend.displayName === 'Cass Nova')
    await expect
      .poll(
        async () => {
          if (await vrx.page.getByRole('main').getByText('Cass Nova').count()) return true
          fake.setVrcFriend({
            id: cass.id,
            state: 'offline',
            location: 'offline',
            status: 'offline'
          })
          fake.setVrcFriend({ id: cass.id, state: 'online', location: 'private', status: 'active' })
          return false
        },
        { interval: 1_000 }
      )
      .toBe(true)

    const { userData } = vrx
    await vrx.close()
    vrx = await launchVrx({ fakePort: fake.port, userData, keepUserData: true })
    // No welcome setup and no sign-in screen: straight to the app, connected.
    await vrx.page.getByRole('heading', { name: 'Dashboard' }).waitFor()

    // The saved activity is back as soon as the page can be opened. While it
    // is on its way the page says so; it never claims there is none.
    await openPage('Activity')
    const activityPage = async () => {
      const text = await vrx.page.getByRole('main').innerText()
      if (text.includes('No activity yet')) return 'empty'
      return text.includes('Cass Nova') ? 'rows' : 'loading'
    }
    let shows = 'loading'
    await expect
      .poll(async () => (shows = await activityPage()), { interval: 100 })
      .not.toBe('loading')
    expect(shows).toBe('rows')

    await waitUntilLive()
    expect(vrx.rendererErrors).toEqual([])
    // The order dragged earlier was saved.
    const nav = vrx.page.getByRole('navigation', { name: 'Main navigation' })
    expect((await nav.getByRole('button').allInnerTexts()).slice(0, 3)).toEqual([
      'Dashboard',
      'Hot Instances',
      'Friends'
    ])
  })
})
