'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Participant = { id: string; name: string; score: number }
type Adjustment = {
  id: string; points: number; adjustment_note: string | null; is_active: boolean
  created_at: string; revoked_at: string | null; admin_name: string | null
}

export default function PointManager({ eventId }: { eventId: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [participants, setParticipants] = useState<Participant[]>([])
  const [history, setHistory] = useState<Adjustment[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState<'add' | 'subtract'>('add')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const operationLock = useRef(false)
  const request = useRef<{ signature: string; id: string } | null>(null)
  const generation = useRef(0)

  const load = useCallback(async () => {
    const current = ++generation.current
    setLoading(true)
    const { data, error } = await supabase.rpc('admin_get_point_management', {
      p_event_id: eventId, p_participant_id: selectedId || null,
    })
    if (current !== generation.current) return
    if (error) setError(error.message)
    else {
      setParticipants(data.participants ?? [])
      setHistory(data.history ?? [])
    }
    setLoading(false)
  }, [eventId, selectedId, supabase])

  useEffect(() => {
    setSelectedId(new URLSearchParams(window.location.search).get('participant') ?? '')
  }, [])
  useEffect(() => { void load(); return () => { generation.current++ } }, [load])

  const selected = participants.find(p => p.id === selectedId)
  const value = Number(amount)
  const valid = amount.trim() !== '' && Number.isInteger(value) && value > 0 && value <= 10000
  const delta = direction === 'add' ? value : -value

  async function adjust() {
    if (!selected || !valid || !note.trim() || operationLock.current || loading) return
    if (!window.confirm(`${selected.name}\n${selected.score} PT → ${selected.score + delta} PT\n理由：${note.trim()}\n\n確定しますか？`)) return
    operationLock.current = true
    setBusy(true); setError(''); setMessage('')
    const signature = JSON.stringify([selected.id, delta, note.trim()])
    if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() }
    try {
      const { error } = await supabase.rpc('admin_adjust_points', {
        p_event_id: eventId, p_participant_id: selected.id, p_points: delta,
        p_note: note.trim(), p_request_id: request.current!.id,
      })
      if (error) throw error
      request.current = null
      setAmount(''); setNote(''); setMessage('ポイントを調整しました。')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : (err as { message?: string }).message ?? '調整できませんでした。') }
    finally { operationLock.current = false; setBusy(false) }
  }

  async function revoke(item: Adjustment) {
    if (operationLock.current || !window.confirm(`この手動調整（${item.points > 0 ? '+' : ''}${item.points} PT）を取り消しますか？`)) return
    operationLock.current = true; setBusy(true); setError(''); setMessage('')
    try {
      const { error } = await supabase.rpc('admin_revoke_point_adjustment', { p_transaction_id: item.id })
      if (error) throw error
      setMessage('手動調整を取り消しました。'); await load()
    } catch (err) { setError((err as { message?: string }).message ?? '取り消せませんでした。') }
    finally { operationLock.current = false; setBusy(false) }
  }

  return <main className="grid" style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
    <Link href="/admin" className="backLink">← Dashboard</Link>
    <div><div className="brand">OUTING 2026 ADMIN</div><h1>ポイント調整</h1></div>
    {error && <p role="alert" style={{ color: '#ef7777' }}>{error}</p>}
    {message && <p role="status">{message}</p>}
    <section className="card grid">
      <label>名前で検索<input className="input" value={query} onChange={e => setQuery(e.target.value)} disabled={busy} /></label>
      <label>参加者<select className="input" value={selectedId} disabled={busy} onChange={e => { setSelectedId(e.target.value); setHistory([]); setAmount(''); setNote(''); setMessage(''); setError('') }}>
        <option value="">参加者を選択</option>
        {participants.filter(p => p.id === selectedId || p.name.toLowerCase().includes(query.toLowerCase())).map(p => <option key={p.id} value={p.id}>{p.name} — {p.score} PT</option>)}
      </select></label>
      {loading && <p role="status">読み込み中...</p>}
      {selected && <>
        <h2>{selected.name}：{selected.score} PT</h2>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <label>操作<select className="input" value={direction} disabled={busy} onChange={e => setDirection(e.target.value as 'add' | 'subtract')}><option value="add">加算</option><option value="subtract">減算</option></select></label>
          <label>ポイント<input className="input" type="number" min={1} max={10000} step={1} value={amount} disabled={busy} onChange={e => setAmount(e.target.value)} /></label>
        </div>
        <label>調整理由（必須）<textarea className="input" maxLength={500} value={note} disabled={busy} onChange={e => setNote(e.target.value)} /></label>
        {valid && <p>変更後：{selected.score + delta} PT</p>}
        <button className="btn primary" disabled={busy || loading || !valid || !note.trim()} onClick={() => void adjust()}>{busy ? '処理中...' : 'ポイントを調整'}</button>
      </>}
    </section>
    {selected && <section className="card grid">
      <h2>手動調整履歴</h2><p className="muted">最新100件。取り消した調整も履歴に残ります。</p>
      {!loading && history.length === 0 && <p>手動調整はありません。</p>}
      {history.map(item => <article key={item.id} style={{ borderTop: '1px solid rgba(255,255,255,.15)', paddingTop: 12 }}>
        <b>{item.points > 0 ? '+' : ''}{item.points} PT{!item.is_active && '（取り消し済み）'}</b>
        <p style={{ whiteSpace: 'pre-wrap' }}>{item.adjustment_note ?? '理由の記録なし'}</p>
        <p className="muted">{new Date(item.created_at).toLocaleString('ja-JP')} · {item.admin_name ?? '管理者'}</p>
        {item.revoked_at && <p className="muted">取り消し：{new Date(item.revoked_at).toLocaleString('ja-JP')}</p>}
        {item.is_active && <button className="btn outline" disabled={busy || loading} onClick={() => void revoke(item)}>この調整を取り消す</button>}
      </article>)}
    </section>}
  </main>
}
