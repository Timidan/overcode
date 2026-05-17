import React from 'react'
import ReactDOM from 'react-dom/client'
import { installBrowserApiFallback } from './lib/browser-api-fallback'
import './styles/reset.css'
import './styles/variables.css'
import './styles/motion.css'
import './styles/animations.css'
import './styles/view-transitions.css'
import './store/useTheme'

installBrowserApiFallback()

async function boot() {
  const { default: App } = await import('./App.tsx')

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

void boot()
