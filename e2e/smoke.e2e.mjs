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

  it('reported no error in the window', () => {
    expect(vrx.rendererErrors).toEqual([])
  })

  it('remembers both sign-ins after a restart', async () => {
    const { userData } = vrx
    await vrx.close()
    vrx = await launchVrx({ fakePort: fake.port, userData, keepUserData: true })
    // No welcome setup and no sign-in screen: straight to the app, connected.
    await vrx.page.getByRole('heading', { name: 'Dashboard' }).waitFor()
    await waitUntilLive()
    expect(vrx.rendererErrors).toEqual([])
  })
})
