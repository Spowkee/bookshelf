import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './styles.css'

// autoUpdate : la nouvelle version s'installe au prochain lancement, sans
// demander. Pour une app perso, une invite de mise a jour est du bruit inutile.
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
