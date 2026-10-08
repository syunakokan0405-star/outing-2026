import type { createClient } from '@/lib/supabase/client'

export const PROFILE_UPDATED_EVENT = 'outing-profile-updated'

// R2 avatar uploads use WebP; older Supabase avatars use JPG.
export function isR2Avatar(path: string) {
  return path.startsWith('avatars/') && path.endsWith('.webp')
}

async function signedAvatarUrlMap(
  supabase: ReturnType<typeof createClient>,
  avatars: { id: string; avatar_path: string | null }[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const legacyPaths = [...new Set(avatars.map(a => a.avatar_path ?? '')
    .filter(path => path && !isR2Avatar(path)))]
  const r2Avatars = avatars.filter(a => a.avatar_path && isR2Avatar(a.avatar_path))
  const results = await Promise.allSettled([
    (async () => {
      if (!legacyPaths.length) return
      const { data, error } = await supabase.storage.from('outing-photos')
        .createSignedUrls(legacyPaths, 60 * 60)
      if (error) throw error
      for (const entry of data ?? []) {
        if (entry.path && entry.signedUrl) map.set(entry.path, entry.signedUrl)
      }
    })(),
    (async () => {
      const ids = [...new Set(r2Avatars.map(a => a.id))]
      for (let start = 0; start < ids.length; start += 150) {
        const response = await fetch('/api/r2/avatar-read-urls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ participantIds: ids.slice(start, start + 150) }),
        })
        if (!response.ok) throw new Error('プロフィール画像URLを取得できませんでした。')
        const { urls } = await response.json() as { urls: Record<string, string> }
        for (const avatar of r2Avatars) {
          if (avatar.avatar_path && urls[avatar.id]) map.set(avatar.avatar_path, urls[avatar.id])
        }
      }
    })(),
  ])
  if (results.some(result => result.status === 'rejected')) {
    console.error('Some profile photos could not be loaded.')
  }
  return map
}

const AVATAR_CACHE_NAME = 'outing-avatar-images-v1'
type Avatar = { id: string; avatar_path: string | null }
// Blob URLs belong to this shared module, and remain valid for this page's lifetime.
// Components must not revoke them on unmount: other screens may still use them.
const localUrls = new Map<string, string>()
const pendingUrls = new Map<string, Promise<string | undefined>>()

function cacheKey(id: string, path: string) {
  return JSON.stringify([id, path])
}

function cacheRequest(id: string, path: string) {
  return new Request(`${window.location.origin}/__avatar-cache__/${id}/${encodeURIComponent(path)}`)
}

async function readCachedAvatar(id: string, path: string): Promise<string | undefined> {
  const key = cacheKey(id, path)
  const memory = localUrls.get(key)
  if (memory) return memory
  if (typeof window === 'undefined' || !('caches' in window)) return
  try {
    const cache = await caches.open(AVATAR_CACHE_NAME)
    const response = await cache.match(cacheRequest(id, path))
    if (!response) return
    const url = URL.createObjectURL(await response.blob())
    localUrls.set(key, url)
    return url
  } catch {
    // Private browsing/quota failures must not prevent photo display.
  }
}

export async function writeCachedAvatar(id: string, path: string, blob: Blob): Promise<string> {
  const url = URL.createObjectURL(blob)
  localUrls.set(cacheKey(id, path), url)
  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const cache = await caches.open(AVATAR_CACHE_NAME)
      await cache.put(cacheRequest(id, path), new Response(blob, {
        headers: { 'Content-Type': blob.type || 'image/webp' },
      }))
    } catch {
      // Still share the uploaded Blob in memory when device storage is unavailable.
    }
  }
  return url
}

export async function avatarUrlMap(
  supabase: ReturnType<typeof createClient>,
  avatars: Avatar[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const owners: { avatar: Avatar; resolve: (url: string | undefined) => void }[] = []
  const requests: { path: string; promise: Promise<string | undefined> }[] = []
  // Reserve each image before awaiting anything, so overlapping screen loads share work.
  for (const avatar of avatars) {
    const path = avatar.avatar_path
    if (!path) continue
    const key = cacheKey(avatar.id, path)
    let promise = pendingUrls.get(key)
    if (!promise) {
      promise = new Promise(resolve => owners.push({ avatar, resolve }))
      pendingUrls.set(key, promise)
    }
    requests.push({ path, promise })
  }

  if (owners.length) {
    // This task always resolves reservations, including storage or network failures.
    void (async () => {
      const missing: typeof owners = []
      try {
        await Promise.all(owners.map(async owner => {
          const url = await readCachedAvatar(owner.avatar.id, owner.avatar.avatar_path!)
          if (url) owner.resolve(url)
          else missing.push(owner)
        }))
        if (missing.length) {
          const signed = await signedAvatarUrlMap(supabase, missing.map(owner => owner.avatar))
          await Promise.all(missing.map(async owner => {
            const path = owner.avatar.avatar_path!
            const signedUrl = signed.get(path)
            if (!signedUrl) return
            // Non-browser callers can resolve signatures without downloading images.
            if (typeof window === 'undefined') {
              owner.resolve(signedUrl)
              return
            }
            try {
              const response = await fetch(signedUrl)
              if (!response.ok) throw new Error('Avatar download failed')
              const url = await writeCachedAvatar(owner.avatar.id, path, await response.blob())
              owner.resolve(url)
            } catch {
              // Allow <img> to render directly when CORS/blob retrieval is unavailable.
              owner.resolve(signedUrl)
            }
          }))
        }
      } catch {
        console.error('Profile photos could not be cached.')
      } finally {
        for (const owner of owners) {
          owner.resolve(undefined)
          pendingUrls.delete(cacheKey(owner.avatar.id, owner.avatar.avatar_path!))
        }
      }
    })()
  }

  await Promise.all(requests.map(async request => {
    const url = await request.promise
    if (url) result.set(request.path, url)
  }))
  return result
}
