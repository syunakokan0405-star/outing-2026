import type { createClient } from '@/lib/supabase/client'

type Participant = { id: string; event_id: string; name: string; avatar_path: string | null }
type Entry = { expires: number; value: Participant | null }
const cached = new Map<string, Entry>()
const pending = new Map<string, Promise<Participant | null>>()
const watched = new WeakSet<object>()
let watchingWindow = false
let generation = 0
function invalidate() { generation++; cached.clear(); pending.clear() }

// UI identity only: authorization still happens through server auth and database RLS.
export async function getBrowserParticipant(supabase: ReturnType<typeof createClient>) {
  if (!watched.has(supabase)) {
    watched.add(supabase)
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN' || event === 'USER_UPDATED') invalidate()
    })
  }
  if (!watchingWindow && typeof window !== 'undefined') {
    watchingWindow = true
    window.addEventListener('outing-profile-updated', invalidate)
  }
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  const user = data.session?.user
  if (!user) return null
  const eventId = process.env.NEXT_PUBLIC_EVENT_ID ?? ''
  const key = `${user.id}:${eventId}`
  const hit = cached.get(key)
  if (hit && hit.expires > Date.now()) return hit.value
  const existing = pending.get(key)
  if (existing) return existing
  const revision = generation
  const request = (async () => {
    let query = supabase.from('participants').select('id,event_id,name,avatar_path')
      .eq('auth_user_id', user.id).eq('is_active', true)
    if (eventId) query = query.eq('event_id', eventId)
    const { data, error } = await query.maybeSingle()
    if (error) throw error
    const value = data as Participant | null
    if (revision !== generation) return null
    if (value) cached.set(key, { value, expires: Date.now() + 30_000 })
    return value
  })()
  pending.set(key, request)
  try { return await request } finally { if (pending.get(key) === request) pending.delete(key) }
}
