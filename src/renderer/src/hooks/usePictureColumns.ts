import { useEffect, useState } from 'react'
import { pictureColumns } from '../utils/pictureColumns'

/** Two columns until the content width is known (also in tests without layout). */
const UNKNOWN_COLUMNS = 2

function columnsFor(width: number): number {
  return width > 0 ? pictureColumns(width) : UNKNOWN_COLUMNS
}

/**
 * Picture card columns for the app's content area (`<main>`), following its
 * width as the window resizes. Pages use it to fill whole rows on wide
 * screens instead of leaving empty space beside a short row.
 */
export function usePictureColumns(): number {
  const [columns, setColumns] = useState(UNKNOWN_COLUMNS)
  useEffect(() => {
    if (typeof document === 'undefined' || typeof ResizeObserver === 'undefined') return
    const main = document.querySelector('main')
    if (main === null) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width ?? 0
      setColumns(columnsFor(width))
    })
    observer.observe(main)
    return () => observer.disconnect()
  }, [])
  return columns
}
