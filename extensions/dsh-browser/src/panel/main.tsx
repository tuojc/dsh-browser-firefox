import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './styles.css'
import { getUiLocale } from '../i18n.ts'
import { PANEL_COPY } from './strings.ts'

const locale = getUiLocale()
document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
document.title = PANEL_COPY[locale].documentTitle

const root = document.getElementById('root')
if (root === null) throw new Error('panel root missing')
createRoot(root).render(<App />)
