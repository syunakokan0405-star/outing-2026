import { backgroundAssetUrl, isBackgroundPath } from '@/lib/background-assets'
import type { createClient } from '@/lib/supabase/client'

const CACHE_NAME = 'outing-shared-storage-images-v2'
const memory = new Map<string, string>()
const pending = new Map<string, Promise<string | undefined>>()
// Shared Blob URLs belong to this module. Callers must not revoke them.
export async function storageImageUrlMap(supabase: ReturnType<typeof createClient>, paths: string[]) {
  const urls = new Map<string, string>()
  const owners: { path: string; resolve: (url: string | undefined) => void }[] = []
  const requests = [...new Set(paths.filter(Boolean))].map(path => {
    let promise = pending.get(path)
    if (!promise) {
      promise = new Promise<string | undefined>(resolve => owners.push({ path, resolve }))
      pending.set(path, promise)
    }
    return { path, promise }
  })
  if (owners.length) void (async () => {
    let cache: Cache | undefined
    const request = (path: string) => new Request(`${window.location.origin}/__outing-cache/storage/${encodeURIComponent(path)}`)
    const missing: typeof owners = []
    try {
      if (typeof window !== 'undefined' && 'caches' in window) {
        try { cache = await caches.open(CACHE_NAME) } catch {}
      }
      await Promise.all(owners.map(async owner => {
        const hit = memory.get(owner.path)
        if (hit) { owner.resolve(hit); return }
        try {
          const stored = await cache?.match(request(owner.path))
          if (stored) {
            const url = URL.createObjectURL(await stored.blob())
            memory.set(owner.path, url)
            owner.resolve(url)
            return
          }
        } catch {}
        missing.push(owner)
      }))
      if (missing.length) {
        const signed = new Map<string, string>()
        const legacy = missing.filter(owner => !isBackgroundPath(owner.path, process.env.NEXT_PUBLIC_EVENT_ID ?? ''))
        for (const owner of missing) {
          if (!legacy.includes(owner)) signed.set(owner.path, backgroundAssetUrl(owner.path))
        }
        if (legacy.length) {
          const { data, error } = await supabase.storage.from('outing-photos')
            .createSignedUrls(legacy.map(owner => owner.path), 60 * 60)
          if (error) throw error
          for (const entry of data ?? []) { if (entry.path && entry.signedUrl) signed.set(entry.path, entry.signedUrl) }
        }
        await Promise.all(missing.map(async owner => {
          const src = signed.get(owner.path)
          if (!src) return
          if (typeof window === 'undefined') { owner.resolve(src); return }
          try {
            const response = await fetch(src)
            if (!response.ok) throw new Error('Image download failed')
            const blob = await response.blob()
            const url = URL.createObjectURL(blob)
            memory.set(owner.path, url)
            try { await cache?.put(request(owner.path), new Response(blob)) } catch {}
            owner.resolve(url)
          } catch { owner.resolve(undefined) }
        }))
      }
    } catch { console.error('Some storage images could not be loaded.') }
    finally {
      for (const owner of owners) { owner.resolve(undefined); pending.delete(owner.path) }
    }
  })()
  await Promise.all(requests.map(async ({path, promise}) => {
    const url = await promise
    if (url) urls.set(path, url)
  }))
  return urls
}
