'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useGameState } from '@/lib/use-ranking-visibility'

export default function RankingVisibilityControl() {
  const eventId = process.env.NEXT_PUBLIC_EVENT_ID
  const game = useGameState(eventId)
  const secret = game?.secret ?? null
  const db = useMemo(() => createClient(), [])
  const [top5, setTop5] = useState<{ participant_id: string; participant_name: string; rank: number; score: number }[]>([])
  useEffect(() => {
    if (eventId) void db.rpc('get_event_top5', { p_event_id: eventId }).then(({ data, error }) => { if (!error) setTop5(data ?? []) })
  }, [db, eventId, secret])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function toggle() {
    if (secret === null || busy) return
    if (!secret && !game?.closed && !window.confirm('得点を固定し、新規投稿を締め切ります。ランキングをシークレットにしてゲームを終了しますか？')) return
    setBusy(true)
    setMessage('')
    try {
      const { error } = await db.rpc('set_ranking_secret', { p_event_id: eventId, p_secret: !secret })
      if (error) throw error
      setMessage(secret ? 'ランキングを公開しました。投稿締切と得点固定は継続します。' : 'ゲームを終了しました。得点を固定し、投稿を締め切りました。')
    } catch (error) { setMessage(error instanceof Error ? error.message : (error as { message?: string })?.message ?? '設定を変更できませんでした。') }
    finally { setBusy(false) }
  }
  return <section className="card" style={{ marginBottom: 24 }}>
    <h2 style={{ fontSize: 18 }}>ゲーム終了・ランキング公開設定</h2>
    <p>現在：{secret === null ? '確認中…' : secret ? 'SECRET（非公開）' : '公開中'}</p>
    <p className="muted">シークレットへの切替と同時に得点を固定し、新規投稿を締め切ります。ストリームは引き続き閲覧できます。ランキングを再公開しても投稿と得点は再開しません。</p>
    <button className="btn" disabled={busy || secret === null} onClick={toggle}>{busy ? '変更中…' : secret ? 'ランキングを公開する' : 'ゲーム終了・シークレットにする'}</button>
    {game?.closed && <p>投稿受付終了・得点確定済み</p>}
    <details style={{ marginTop: 16 }}><summary>管理者用 TOP5を確認</summary>
      <ol style={{ listStyle: 'none', padding: 0 }}>{top5.map(row => <li key={row.participant_id} style={{ padding: '6px 0' }}>{row.rank}位　{row.participant_name}　{row.score} pt</li>)}</ol>
    </details>
    <p role="status">{message}</p>
  </section>
}
