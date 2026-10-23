'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// Never reveal cached rankings until the current event setting is verified.
export function useGameState(eventId?: string) {
  const db = useMemo(() => createClient(), [])
  const [state, setState] = useState<{ secret: boolean; closed: boolean } | null>(null)
  useEffect(() => {
    setState(null)
    if (!eventId) return
    let disposed = false
    let revision = 0
    const refresh = async () => {
      const current = ++revision
      const { data, error } = await db.from('events').select('ranking_secret,game_closed_at').eq('id', eventId).single()
      if (!disposed && current === revision) setState(error ? null : { secret: data.ranking_secret, closed: !!data.game_closed_at })
    }
    const resume = () => {
      if (document.visibilityState === 'visible') { setState(null); void refresh() }
    }
    const channel = db.channel(`ranking-visibility:${eventId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${eventId}` }, payload => {
        revision++
        setState({ secret: payload.new.ranking_secret === true, closed: !!payload.new.game_closed_at })
      }).subscribe(status => { if (status === 'SUBSCRIBED') void refresh() })
    void refresh()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 30_000)
    window.addEventListener('focus', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      disposed = true
      window.clearInterval(timer)
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', resume)
      void db.removeChannel(channel)
    }
  }, [db, eventId])
  return state
}

export function useRankingVisibility(eventId?: string) {
  return useGameState(eventId)?.secret ?? null
}
