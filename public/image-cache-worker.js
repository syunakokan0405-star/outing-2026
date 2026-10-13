// Keep existing mission, avatar and post caches intact.
const STATIC_CACHE = 'outing-static-images-20261013-v1'
const IMAGE_CACHE = 'outing-runtime-images-v1'
const inflight = new Map()
const fixedImages = ['/outing-bg.jpg', '/mission-default.jpg', '/brand/nic-header.svg', '/icons/nic-dark-v2-32.png', '/icons/nic-dark-v2-180.png', '/icons/nic-dark-v2-192.png', '/icons/nic-dark-v2-512.png']
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE)
    await Promise.allSettled(fixedImages.map(async path => {
      const response = await fetch(new Request(path, {cache: 'reload'}))
      if (response.ok && response.headers.get('content-type')?.startsWith('image/')) await cache.put(path, response)
    }))
    await self.skipWaiting()
  })())
})
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
function imageKey(request) {
  const url = new URL(request.url)
  if (!['http:', 'https:'].includes(url.protocol) || request.method !== 'GET') return null
  const local = url.origin === self.location.origin
  const storage = url.hostname.endsWith('.r2.cloudflarestorage.com') || url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/storage/v1/object/')
  if (!local && !storage) return null
  if (!(request.destination === 'image' || /\.(?:png|jpe?g|gif|webp|avif|svg|ico)$/i.test(url.pathname) || local && ['/api/r2/assets', '/_next/image'].includes(url.pathname))) return null
  // Preserve version/path/transform parameters. Only ephemeral signatures are removed.
  if (storage) for (const key of [...url.searchParams.keys()]) {
    if (/^x-amz-/i.test(key) || key === 'token') url.searchParams.delete(key)
  }
  return {key: url.href, local, cache: local && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/_next/image') ? STATIC_CACHE : IMAGE_CACHE}
}
async function loadImage(request, info) {
  let cache
  try { cache = await caches.open(info.cache); const hit = await cache.match(info.key); if (hit) return hit } catch {}
  let response
  // Readable CORS responses let us reject failures instead of caching opaque errors.
  if (!info.local && request.mode === 'no-cors') {
    try { response = await fetch(new Request(request, {mode: 'cors', credentials: 'omit'})) } catch { return fetch(request) }
  } else response = await fetch(request)
  if (response.ok && response.headers.get('content-type')?.startsWith('image/')) {
    try { await cache?.put(info.key, response.clone()) } catch {}
  }
  return response
}
self.addEventListener('fetch', event => {
  const info = imageKey(event.request)
  if (!info) return
  event.respondWith((async () => {
    let task = inflight.get(info.key)
    if (!task) {
      task = loadImage(event.request, info)
      inflight.set(info.key, task)
      task.finally(() => { if (inflight.get(info.key) === task) inflight.delete(info.key) }).catch(() => {})
    }
    return (await task).clone()
  })())
})
