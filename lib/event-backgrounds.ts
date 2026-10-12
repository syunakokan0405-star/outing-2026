import type { createClient } from '@/lib/supabase/client'
type Backgrounds = { ranking_background_path: string | null; announcement_background_path: string | null; guide_background_path: string | null }
const cached = new Map<string, { expires: number; value: Backgrounds | null }>()
const pending = new Map<string, Promise<{ data: Backgrounds | null; error: any }>>()
let generation = 0
export function invalidateEventBackgrounds() { generation++; cached.clear(); pending.clear() }
// A short, per-account cache shares the three homepage/guide/ranking metadata reads.
export async function getEventBackgrounds(db: ReturnType<typeof createClient>, eventId: string) {
  const { data: session, error } = await db.auth.getSession()
  if (error || !session.session) return { data: null, error: error || new Error('Unauthorized') }
  const key = `${session.session.user.id}:${eventId}`
  const hit = cached.get(key)
  if (hit && hit.expires > Date.now()) return { data: hit.value, error: null }
  const running = pending.get(key)
  if (running) return running
  const revision = generation
  const request = (async () => {
    const result = await db.from('events').select('ranking_background_path,announcement_background_path,guide_background_path').eq('id', eventId).maybeSingle()
    if (!result.error && revision === generation) cached.set(key, { value: result.data, expires: Date.now() + 30_000 })
    return result
  })()
  pending.set(key, request)
  try { return await request } finally { if (pending.get(key) === request) pending.delete(key) }
}
