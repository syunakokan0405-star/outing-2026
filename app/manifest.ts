import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Outing 2026',
    short_name: 'Outing 2026',
    description: 'Outing 2026 event app',
    lang: 'ja',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0d0f14',
    theme_color: '#0d0f14',
    icons: [
      { src: '/icons/nic-dark-v2-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/nic-dark-v2-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }
}
