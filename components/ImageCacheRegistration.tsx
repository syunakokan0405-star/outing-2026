'use client'
import { useEffect } from 'react'

export default function ImageCacheRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    void navigator.serviceWorker.register('/image-cache-worker.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
      // Existing component caches and normal HTTP caching remain available.
    })
  }, [])
  return null
}
