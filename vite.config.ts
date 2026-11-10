import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Les systèmes de fichiers montés (lecteur réseau, partage Windows sous WSL)
 * ne propagent pas les notifications inotify : sans scrutation active, le
 * rechargement à chaud ne se déclenche jamais. Le polling coûtant du CPU, il
 * ne s'active que dans ce cas ; sur un disque local, inotify suffit.
 */
const onMountedFs = process.cwd().startsWith('/mnt/')

/**
 * Chemin racine sous lequel l'app est servie.
 *
 * À la racine d'un domaine (Cloudflare Pages, domaine perso), c'est « / ».
 * Sur GitHub Pages, le site vit dans un sous-dossier portant le nom du dépôt
 * — https://pseudo.github.io/bookshelf/ — et tout doit être préfixé, sinon le
 * service worker et les icônes partent en 404 et l'app refuse de s'installer.
 *
 * La valeur vient de l'environnement pour que le même code marche sur les deux
 * hébergeurs sans modification : le workflow GitHub Pages renseigne BASE_PATH,
 * ailleurs on reste à la racine.
 */
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-180.png', 'icon-192.png', 'icon-512.png', 'favicon.svg'],
      manifest: {
        name: 'Bookshelf — journal de lecture',
        short_name: 'Bookshelf',
        description: 'Scanne tes livres, garde la trace de tes lectures. Tout reste sur ton appareil.',
        theme_color: '#1a1614',
        background_color: '#1a1614',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        lang: 'fr',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Le .wasm est volontairement hors du precache : Android ne l'utilise
        // jamais, et sur iOS il se telecharge au premier scan puis reste en
        // cache (regle runtime ci-dessous). Le scan exige le reseau de toute
        // facon, puisqu'il faut interroger l'API juste apres.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            // Binaire ZXing : telecharge a la demande, garde pour toujours.
            urlPattern: /\.wasm$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'scanner-wasm',
              expiration: { maxEntries: 4 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Couvertures distantes : cache long, elles ne changent jamais.
            urlPattern: /^https:\/\/covers\.openlibrary\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'covers',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Metadonnees : reseau d'abord, cache de secours si hors-ligne.
            urlPattern: /^https:\/\/(openlibrary\.org|www\.googleapis\.com)\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'book-api',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    // 5173 est le defaut de Vite, souvent deja pris par un autre projet.
    port: 5180,
    watch: onMountedFs ? { usePolling: true, interval: 300 } : undefined,
  },
})
