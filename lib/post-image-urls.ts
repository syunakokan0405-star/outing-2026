export const POST_IMAGE_CACHE = 'outing-post-images-v3'
export function postImageCacheRequest(id: string) {
  return new Request(`${window.location.origin}/__outing-cache/post-thumb/${id}`)
}
type R2Post = { id: string; storage_provider: string; r2_object_key: string | null; r2_thumbnail_key: string | null }
type Variant = 'original' | 'thumbnail'
const signed = new Map<string, { url: string; expires: number }>()
const pending = new Map<string, Promise<string | undefined>>()
// Keep variants/object revisions separate; cached blobs are owned by the image component.
export async function r2PostUrlMap(posts: R2Post[], variant: Variant, checkImageCache = true) {
  const result = new Map<string, string>()
  let cache: Cache | undefined
  if (checkImageCache && typeof window !== 'undefined' && 'caches' in window) {
    try { cache = await caches.open(POST_IMAGE_CACHE) } catch {}
  }
  const waiting: { id: string; task: Promise<string | undefined> }[] = []
  const owners: { id: string; key: string; resolve: (url: string | undefined) => void }[] = []
  await Promise.all(posts.filter(post => post.storage_provider === 'r2' && (post.r2_object_key || post.r2_thumbnail_key)).map(async post => {
    const imageId = variant === 'original' ? `stream-original:${post.id}` : `gallery-thumb:${post.id}`
    try { if (await cache?.match(postImageCacheRequest(imageId))) return } catch {}
    const key = JSON.stringify([post.id, variant, post.r2_object_key, post.r2_thumbnail_key])
    const hit = signed.get(key)
    if (hit && hit.expires > Date.now()) { result.set(post.id, hit.url); return }
    signed.delete(key)
    let task = pending.get(key)
    if (!task) {
      task = new Promise(resolve => owners.push({ id: post.id, key, resolve }))
      pending.set(key, task)
    }
    // Start the batched request after all owners have reserved their entries.
    waiting.push({ id: post.id, task })
  }))
  async function issue() {
    try {
      for (let index = 0; index < owners.length; index += 150) {
        const batch = owners.slice(index, index + 150)
        const response = await fetch('/api/r2/read-urls', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postIds: batch.map(owner => owner.id), variant }),
        })
        if (!response.ok) continue
        const data = await response.json() as { urls?: Record<string, string> }
        for (const owner of batch) {
          const url = data.urls?.[owner.id]
          if (url) {
            // Server signatures last one hour; leave five minutes for clock/network delay.
            signed.set(owner.key, { url, expires: Date.now() + 55 * 60_000 })
            owner.resolve(url)
          }
        }
      }
    } catch { /* Reservations are released below so a later render can retry. */ }
    finally { for (const owner of owners) { owner.resolve(undefined); pending.delete(owner.key) } }
  }
  if (owners.length) void issue()
  await Promise.all(waiting.map(async ({id,task}) => { const url = await task; if (url) result.set(id,url) }))
  return result
}
