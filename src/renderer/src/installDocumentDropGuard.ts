/** Prevent browser file drops from replacing the sandboxed renderer document. */
export function installDocumentDropGuard(document: Document): () => void {
  const preventDocumentDrop = (event: DragEvent): void => {
    event.preventDefault()
  }

  document.addEventListener('dragover', preventDocumentDrop, true)
  document.addEventListener('drop', preventDocumentDrop, true)

  return () => {
    document.removeEventListener('dragover', preventDocumentDrop, true)
    document.removeEventListener('drop', preventDocumentDrop, true)
  }
}
