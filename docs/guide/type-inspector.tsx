import { useEffect, useState } from 'react'

const roles = [
  ['Page title', 'h1'],
  ['Section heading', 'h2'],
  ['World-card title', '[data-explore-sheet-opener] h3'],
  ['Statistic', '[aria-live="polite"]'],
  ['Statistic label', '[aria-live="polite"] + div'],
  ['Control', '[role="radio"]'],
  ['Hot-instance title', '[data-hot-sheet-opener] .col-start-1.row-start-1']
] as const

interface MeasuredRole {
  role: string
  sample: string
  family: string
  size: string
  weight: string
  lineHeight: string
}

/** Displays computed typography from the rendered components below, never a copied scale. */
export default function TypeInspector({ root }: { root: HTMLElement | null }): React.JSX.Element {
  const [measured, setMeasured] = useState<MeasuredRole[]>([])
  useEffect(() => {
    if (root === null) return
    let active = true
    const read = (): void => {
      if (!active) return
      const next = roles.flatMap(([role, selector]) => {
        const element = root.querySelector<HTMLElement>(selector)
        if (!element) return []
        const style = getComputedStyle(element)
        return [
          {
            role,
            sample: element.textContent?.trim() ?? '',
            family: style.fontFamily.split(',')[0]?.replaceAll('"', '') ?? '',
            size: style.fontSize,
            weight: style.fontWeight,
            lineHeight: style.lineHeight
          }
        ]
      })
      setMeasured((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next
      )
    }
    void document.fonts.ready.then(read)
    const observer = new MutationObserver(read)
    observer.observe(root, { subtree: true, childList: true, characterData: true })
    return () => {
      active = false
      observer.disconnect()
    }
  }, [root])
  return (
    <div className="fixture-type-table">
      <table>
        <caption>Measured from the real components below</caption>
        <thead>
          <tr>
            <th>Role</th>
            <th>Example</th>
            <th>Font</th>
            <th>Size / weight / line</th>
          </tr>
        </thead>
        <tbody>
          {measured.map((item) => (
            <tr key={item.role}>
              <th scope="row">{item.role}</th>
              <td>{item.sample}</td>
              <td>{item.family}</td>
              <td>
                {item.size} / {item.weight} / {item.lineHeight}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
