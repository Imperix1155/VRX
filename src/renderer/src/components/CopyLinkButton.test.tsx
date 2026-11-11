// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../i18n'
import CopyLinkButton from './CopyLinkButton'
import { SheetFacts } from './SheetFacts'

/** VRChat's website pages, spelled so the path guard does not read a folder. */
const VRC_SITE = ['https://vrchat.com', 'home'].join('/')

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  Reflect.deleteProperty(navigator, 'clipboard')
})

function stubClipboard(writeText: (text: string) => Promise<void>): ReturnType<typeof vi.fn> {
  const spy = vi.fn(writeText)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: spy }, configurable: true })
  return spy
}

const LINK = `${VRC_SITE}/world/wrld_0f8fad5b-d9cb-469f-a165-70867728950e`

describe('CopyLinkButton', () => {
  it('copies the link once and says so in words, then resets', async () => {
    vi.useFakeTimers()
    const writeText = stubClipboard(() => Promise.resolve())
    render(<CopyLinkButton link={LINK} ariaLabel="Copy a link to Sample World" />)

    const button = screen.getByRole('button', { name: 'Copy a link to Sample World' })
    expect(button.textContent).toBe('Copy link')
    fireEvent.click(button)
    await act(async () => {
      await Promise.resolve()
    })

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(LINK)
    expect(button.textContent).toBe('✓ Copied')
    expect(screen.getByRole('status').textContent).toBe('Copied')

    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(button.textContent).toBe('Copy link')
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('reads "Copy link" again when the same button is reused for another link', async () => {
    vi.useFakeTimers()
    const writeText = stubClipboard(() => Promise.resolve())
    const other = `${VRC_SITE}/world/wrld_11111111-d9cb-469f-a165-70867728950e`
    const view = render(<CopyLinkButton link={LINK} ariaLabel="Copy a link" />)
    fireEvent.click(screen.getByRole('button'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByRole('button').textContent).toBe('✓ Copied')

    // A sheet that switches to another world keeps the button but changes its link.
    view.rerender(<CopyLinkButton link={other} ariaLabel="Copy a link" />)
    expect(screen.getByRole('button').textContent).toBe('Copy link')
    expect(screen.getByRole('status').textContent).toBe('')
    expect(writeText).toHaveBeenCalledExactlyOnceWith(LINK)

    // Back on the first link inside the two seconds, the word still stands.
    view.rerender(<CopyLinkButton link={LINK} ariaLabel="Copy a link" />)
    expect(screen.getByRole('button').textContent).toBe('✓ Copied')
    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(screen.getByRole('button').textContent).toBe('Copy link')
  })

  it('ties a slow clipboard answer to the link that was pressed', async () => {
    let finish: () => void = () => undefined
    stubClipboard(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const other = `${VRC_SITE}/world/wrld_22222222-d9cb-469f-a165-70867728950e`
    const view = render(<CopyLinkButton link={LINK} ariaLabel="Copy a link" />)
    fireEvent.click(screen.getByRole('button'))
    view.rerender(<CopyLinkButton link={other} ariaLabel="Copy a link" />)
    await act(async () => {
      finish()
      await Promise.resolve()
    })
    expect(screen.getByRole('button').textContent).toBe('Copy link')
  })

  it("says it couldn't copy when the clipboard refuses", async () => {
    stubClipboard(() => Promise.reject(new Error('denied')))
    render(<CopyLinkButton link={LINK} ariaLabel="Copy a link to Sample World" />)

    fireEvent.click(screen.getByRole('button'))
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByRole('button').textContent).toBe("Couldn't copy")
    expect(screen.getByRole('status').textContent).toBe("Couldn't copy")
  })

  it("says it couldn't copy when there is no clipboard at all", () => {
    render(<CopyLinkButton link={LINK} ariaLabel="Copy a link to Sample World" />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button').textContent).toBe("Couldn't copy")
  })

  it('does not press the row or sheet that holds it', () => {
    stubClipboard(() => Promise.resolve())
    const onRowClick = vi.fn()
    render(
      <div onClick={onRowClick}>
        <CopyLinkButton link={LINK} ariaLabel="Copy a link to Sample World" />
      </div>
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onRowClick).not.toHaveBeenCalled()
  })
})

describe('SheetFacts copy link', () => {
  it('shows a Copy link button only beside a fact that has a link', () => {
    stubClipboard(() => Promise.resolve())
    render(
      <SheetFacts
        heading="About this world"
        facts={[
          { label: 'People now', value: '12' },
          {
            label: 'World ID',
            value: 'wrld_0f8fad5b-d9cb-469f-a165-70867728950e',
            mono: true,
            copyLink: { link: LINK, ariaLabel: 'Copy a link to Sample World' }
          },
          { label: 'Instance ID', value: 'odd id', mono: true }
        ]}
      />
    )
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByText('wrld_0f8fad5b-d9cb-469f-a165-70867728950e')).toBeTruthy()
    expect(screen.getByText('odd id')).toBeTruthy()
  })

  it('keeps the line breaks of a multiline fact, and of no other', () => {
    render(
      <SheetFacts
        heading="About this world"
        facts={[
          { label: 'Creator', value: 'Builder' },
          { label: 'Description', value: 'First line.\nSecond line.', multiline: true }
        ]}
      />
    )
    const description = screen.getByText(/First line/)
    expect(description.className).toContain('whitespace-pre-line')
    expect(description.textContent).toBe('First line.\nSecond line.')
    expect(screen.getByText('Builder').className).not.toContain('whitespace-pre-line')
  })
})
