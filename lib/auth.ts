import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export function getEventId() {
  const eventId = process.env.NEXT_PUBLIC_EVENT_ID
  if (!eventId) throw new Error('NEXT_PUBLIC_EVENT_ID is not configured')
  return eventId
}

export async function getCurrentParticipant() {
  const supabase = await createClient()
  const eventId = getEventId()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('participants')
    .select('id,name,event_id')
    .eq('event_id', eventId)
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  return data ?? null
}

export async function requireParticipant() {
  const participant = await getCurrentParticipant()
  if (!participant) redirect('/join')
  return participant
}

export async function getCurrentAdmin() {
  const supabase = await createClient()
  const eventId = getEventId()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('admin_users')
    .select('id,display_name,role,can_manage_missions,can_manage_stream,can_manage_photos,can_manage_awards,can_manage_guide,can_manage_participants')
    .eq('event_id', eventId)
    .eq('auth_user_id', user.id)
    .maybeSingle()

  return data ?? null
}

export async function requireAdmin() {
  const admin = await getCurrentAdmin()
  if (!admin) redirect('/admin/login?error=unauthorized')
  return admin
}
