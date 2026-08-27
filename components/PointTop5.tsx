'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type RankRow = {
  rank: number
  participant_id: string
  participant_name: string
  score: number
}

export default function PointTop5() {
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<RankRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const { data: authData } = await supabase.auth.getUser()
    if (!authData.user) {
      setError('参加者ログイン後にランキングを表示できます。')
      setLoading(false)
      return
    }

    const { data: participant, error: participantError } = await supabase
      .from('participants')
      .select('event_id')
      .eq('auth_user_id', authData.user.id)
      .maybeSingle()

    if (participantError || !participant) {
      setError('参加者情報を取得できませんでした。')
      setLoading(false)
      return
    }

    const { data, error: rankError } = await supabase.rpc('get_event_top5', {
      p_event_id: participant.event_id,
    })

    if (rankError) {
      setError(rankError.message)
      setLoading(false)
      return
    }

    setRows((data ?? []).map((row: any) => ({
      rank: Number(row.rank),
      participant_id: row.participant_id,
      participant_name: row.participant_name,
      score: Number(row.score ?? 0),
    })))
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    void load()

    // Other participants' point ledger rows are intentionally private, so the
    // public Top 5 refreshes from visible post activity plus a short interval.
    const channel = supabase
      .channel('home-point-ranking')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, () => void load())
      .subscribe()
    const timer = window.setInterval(() => void load(), 15000)
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      void supabase.removeChannel(channel)
    }
  }, [load, supabase])

  return <section className="card rankingCard">
    <div className="row"><b>POINT RANKING TOP 5</b><span>🏆</span></div>
    {loading && <p className="muted">ランキングを読み込み中…</p>}
    {!loading && error && <p className="muted">{error}</p>}
    {!loading && !error && !rows.length && <p className="muted">まだ得点がありません。</p>}
    {!loading && !error && !!rows.length && <ol className="rankingList">
      {rows.map(row => <li key={row.participant_id}>
        <span className="rankNumber">{row.rank}</span>
        <Link href={`/profile/${row.participant_id}`}>{row.participant_name}</Link>
        <b>{row.score}pt</b>
      </li>)}
    </ol>}
  </section>
}
