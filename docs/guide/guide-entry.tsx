import './production.css'
import '@renderer/i18n'
import { createRoot } from 'react-dom/client'
import Guide from './guide'

document.body.classList.add('guide-document')
const root = document.getElementById('root')
if (root === null) throw new Error('Missing guide root')
createRoot(root).render(<Guide />)
