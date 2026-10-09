'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Post = {
  id: string; participant_id: string; participant_name: string; mission_title: string | null
  comment: string | null; visibility: string; created_at: string; deleted_at: string | null
  deleted_reason: string | null; can_restore: boolean; earned_points: number
}

export default function PhotoManager({ eventId }: { eventId: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [participants, setParticipants] = useState<{ id: string; name: string }[]>([])
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [cancelled, setCancelled] = useState(false)
  const [offset, setOffset] = useState(0)
  const [posts, setPosts] = useState<Post[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [cancelTarget, setCancelTarget] = useState<Post | null>(null)
  const [reason, setReason] = useState('')
  const generation = useRef(0)
  const operationLock = useRef(false)

  useEffect(() => {
    setSelectedId(new URLSearchParams(window.location.search).get('participant') ?? '')
    void (async () => {
      const { data, error } = await supabase.from('participants').select('id,name').eq('event_id', eventId).order('name')
      if (error) setError(error.message)
      else setParticipants(data ?? [])
    })()
  }, [eventId, supabase])

  const load = useCallback(async () => {
    const current = ++generation.current
    setLoading(true); setError(''); setPosts([]); setUrls({})
    try {
      const { data, error } = await supabase.rpc('admin_list_photos', {
        p_event_id: eventId, p_participant_id: selectedId || null, p_cancelled: cancelled, p_offset: offset,
      })
      if (error) throw error
      if (current !== generation.current) return
      const rows = (data ?? []) as Post[]
      setPosts(rows)
      if (rows.length) {
        const response = await fetch('/api/admin/photos/urls', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postIds: rows.map(p => p.id) }),
        })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error ?? '写真を取得できませんでした。')
        if (current === generation.current) setUrls(body.urls ?? {})
      }
    } catch (err) {
      if (current === generation.current) setError((err as { message?: string }).message ?? '読み込めませんでした。')
    } finally { if (current === generation.current) setLoading(false) }
  }, [eventId, selectedId, cancelled, offset, supabase])
  useEffect(() => { void load(); return () => { generation.current++ } }, [load])

  async function mutate(post: Post, restore: boolean) {
    if (operationLock.current) return
    if (restore && !window.confirm(`${post.participant_name}の投稿を復元しますか？\n同じMissionが再クリア済みの場合、写真のみ復元して二重加点を防ぎます。`)) return
    if (!restore && !window.confirm(`${post.participant_name}の投稿を取り消しますか？\nこの投稿の獲得ポイント（メンション分も含む）を取り消します。初回クリアの投稿ならMissionは未クリアに戻ります。`)) return
    operationLock.current = true; setBusy(true); setError(''); setMessage('')
    try {
      const { data, error } = restore
        ? await supabase.rpc('admin_restore_post', { p_post_id: post.id })
        : await supabase.rpc('admin_cancel_post', { p_post_id: post.id, p_reason: reason.trim() })
      if (error) throw error
      setCancelTarget(null); setReason('')
      await load()
      setMessage(restore ? (data?.points_restored ? '投稿・ポイント・Missionクリアを復元しました。' : '写真を復元しました。ポイントとMissionクリアは変更していません。') : '投稿を取り消しました。「取り消し済み」から復元できます。')
    } catch (err) { setError((err as { message?: string }).message ?? '操作できませんでした。') }
    finally { operationLock.current = false; setBusy(false) }
  }

  return <main className="grid" style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
    <Link className="backLink" href="/admin">← Dashboard</Link>
    <div><div className="brand">OUTING 2026 ADMIN</div><h1>写真管理</h1><p className="muted">参加者別に投稿を確認・取り消し・復元できます。</p></div>
    <section className="card grid">
      <label>名前で検索<input className="input" value={query} disabled={busy} onChange={e => setQuery(e.target.value)} /></label>
      <label>参加者<select className="input" value={selectedId} disabled={busy} onChange={e => { setSelectedId(e.target.value); setOffset(0); setCancelTarget(null); setMessage('') }}>
        <option value="">全参加者</option>
        {participants.filter(p => p.id === selectedId || p.name.toLowerCase().includes(query.toLowerCase())).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className={`btn ${!cancelled ? 'primary' : 'outline'}`} disabled={busy} onClick={() => { setCancelled(false); setOffset(0); setCancelTarget(null) }}>公開中</button>
        <button className={`btn ${cancelled ? 'primary' : 'outline'}`} disabled={busy} onClick={() => { setCancelled(true); setOffset(0); setCancelTarget(null) }}>取り消し済み</button>
        <button className="btn outline" disabled={busy || loading} onClick={() => void load()}>更新</button>
      </div>
    </section>
    {error && <p role="alert" style={{ color: '#ef7777' }}>{error}</p>}
    {message && <p role="status">{message}</p>}
    {loading ? <p role="status">読み込み中...</p> : <>
      {posts.length === 0 && <section className="card">この条件の投稿はありません。</section>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(280px,100%),1fr))', gap: 16 }}>
        {posts.map(post => <article className="card grid" key={post.id}>
          {urls[post.id] ? <img src={urls[post.id]} alt={`${post.participant_name}の投稿写真`} loading="lazy" style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'contain', borderRadius: 12 }} /> : <p className="muted">写真を表示できません。</p>}
          <b>{post.participant_name}</b>
          <div style={{ whiteSpace: 'pre-wrap' }}>Mission：{post.mission_title ?? 'お題なし'}</div>
          <div>獲得ポイント：{post.earned_points} PT（投稿者分）</div>
          <div className="muted">{post.visibility === 'stream' ? 'Stream' : 'Gallery'} · {new Date(post.created_at).toLocaleString('ja-JP')}</div>
          {post.comment && <p>{post.comment}</p>}
          {post.deleted_at ? <>
            <p className="muted">取り消し：{new Date(post.deleted_at).toLocaleString('ja-JP')}<br />理由：{post.deleted_reason ?? '記録なし'}</p>
            {post.can_restore ? <button className="btn outline" disabled={busy} onClick={() => void mutate(post, true)}>投稿を復元</button> : <p className="muted">復元できません（従来の削除・本人の削除・保存期間終了）。</p>}
          </> : cancelTarget?.id === post.id ? <>
            <label>取り消し理由（必須）<textarea className="input" value={reason} maxLength={500} disabled={busy} onChange={e => setReason(e.target.value)} autoFocus /></label>
            <button className="btn outline" disabled={busy || !reason.trim()} onClick={() => void mutate(post, false)}>取り消しを確定</button>
            <button className="btn outline" disabled={busy} onClick={() => setCancelTarget(null)}>やめる</button>
          </> : <button className="btn outline" style={{ color: '#ef7777' }} disabled={busy} onClick={() => { setCancelTarget(post); setReason('') }}>投稿を取り消す</button>}
        </article>)}
      </div>
      <div className="row">
        <button className="btn outline" disabled={busy || offset === 0} onClick={() => { setOffset(Math.max(0, offset - 60)); setCancelTarget(null) }}>前へ</button>
        <span>{offset / 60 + 1}ページ</span>
        <button className="btn outline" disabled={busy || posts.length < 60} onClick={() => { setOffset(offset + 60); setCancelTarget(null) }}>次へ</button>
      </div>
    </>}
  </main>
}
