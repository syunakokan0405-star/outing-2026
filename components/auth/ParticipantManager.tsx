'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type ParticipantRow = { id: string; name: string; claimed_at: string | null; auth_user_id: string | null; is_active: boolean }

export default function ParticipantManager({ eventId }: { eventId: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<ParticipantRow[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('participants')
      .select('id,name,claimed_at,auth_user_id,is_active')
      .eq('event_id', eventId)
      .order('name')
    if (error) setMessage(error.message)
    setRows((data ?? []) as ParticipantRow[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function unlock(id: string, name: string) {
    if (!confirm(`${name} の端末ロックを解除しますか？`)) return
    setMessage('')
    const { error } = await supabase.rpc('reset_participant_claim', { p_participant_id: id })
    if (error) { setMessage(error.message); return }
    setMessage(`${name} のロックを解除しました。`)
    await load()
  }

  const filtered = rows.filter((row) => row.name.toLowerCase().includes(query.toLowerCase()))

  return <div className="grid">
    <div className="row"><div><div className="brand">OUTING 2026</div><h1>Participants</h1></div><span className="muted">{rows.length}人</span></div>
    <section className="card grid">
      <input className="input" placeholder="名前で検索" value={query} onChange={(e) => setQuery(e.target.value)} />
      {message && <div className={message.includes('解除しました') ? 'statusSuccess' : 'statusError'}>{message}</div>}
      {loading ? <p className="muted">読み込み中…</p> : <div style={{ overflowX: 'auto' }}><table className="adminTable"><thead><tr><th>名前</th><th>端末</th><th>Claim時刻</th><th></th></tr></thead><tbody>
        {filtered.map((row) => <tr key={row.id}><td><b>{row.name}</b></td><td><span className={`statusDot ${row.auth_user_id ? 'on' : 'off'}`} />{row.auth_user_id ? 'ロック済み' : '未使用'}</td><td>{row.claimed_at ? new Date(row.claimed_at).toLocaleString('ja-JP') : '—'}</td><td>{row.auth_user_id && <button className="btn outline" onClick={() => unlock(row.id, row.name)}>ロック解除</button>}</td></tr>)}
      </tbody></table></div>}
    </section>
  </div>
}
