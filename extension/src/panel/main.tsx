import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './styles.css'

const root = document.getElementById('root')
if (root === null) throw new Error('panel root missing')
createRoot(root).render(<App />)
