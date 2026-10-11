import { PROFILE_UPDATED_EVENT } from '@/lib/avatar-urls'
import { createClient } from '@/lib/supabase/client'
export type HiddenBonus = 'connections_20' | 'hearts_15' | 'home_icon' | 'schedule_read' | 'rules_read'
export async function claimHiddenBonus(kind: HiddenBonus) {
  try {
    const { data, error } = await createClient().rpc('claim_hidden_bonus', {
      p_event_id: process.env.NEXT_PUBLIC_EVENT_ID ?? '', p_kind: kind,
    })
    if (error) { console.error('Hidden bonus claim failed', error); return false }
    if (Number(data) > 0) {
      window.dispatchEvent(new CustomEvent('outing:hidden-bonus', { detail: Number(data) }))
      window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT))
    }
    return true
  } catch (error) { console.error('Hidden bonus claim failed', error); return false }
}
