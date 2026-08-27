'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type ParticipantChoice = {
  participant_id: string
  participant_name: string
  is_claimed: boolean
}

const CONSENT_VERSION = '2026-08-v1'

export default function ParticipantJoin({ eventId }: { eventId: string }) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [choices, setChoices] = useState<ParticipantChoice[]>([])
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [consent, setConsent] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function boot() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        let authUser = user
        if (!authUser) {
          const { data, error: signInError } = await supabase.auth.signInAnonymously()
          if (signInError) throw signInError
          authUser = data.user
        }

        if (!authUser) throw new Error('匿名ログインを開始できませんでした')

        const { data: mine } = await supabase
          .from('participants')
          .select('id')
          .eq('event_id', eventId)
          .eq('auth_user_id', authUser.id)
          .maybeSingle()

        if (mine?.id) {
          router.replace('/')
          router.refresh()
          return
        }

        const { data, error: listError } = await supabase.rpc('list_available_participants', {
          p_event_id: eventId,
        })
        if (listError) throw listError
        if (!cancelled) setChoices((data ?? []) as ParticipantChoice[])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '名簿を読み込めませんでした')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void boot()
    return () => { cancelled = true }
  }, [eventId, router, supabase])

  const filtered = choices.filter((p) => p.participant_name.toLowerCase().includes(query.trim().toLowerCase()))

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!selected || !consent || submitting) return
    setSubmitting(true)
    setError('')
    const { error: claimError } = await supabase.rpc('claim_participant', {
      p_event_id: eventId,
      p_participant_id: selected,
    })
    if (claimError) {
      setError(claimError.message.includes('already claimed')
        ? 'この名前はすでに別の端末で使用されています。運営に確認してください。'
        : claimError.message)
      setSubmitting(false)
      return
    }

    const { error: consentError } = await supabase.rpc('record_participant_consent', {
      p_event_id: eventId,
      p_consent_version: CONSENT_VERSION,
    })
    if (consentError) {
      setError('参加登録は完了しましたが、同意記録の保存に失敗しました。運営に確認してください。')
      setSubmitting(false)
      return
    }

    router.replace('/')
    router.refresh()
  }

  return <form onSubmit={submit} className="card grid" style={{ gap: 14 }}>
    <div>
      <div className="brand">OUTING 2026</div>
      <h1>参加登録</h1>
      <p className="muted">名前を選び、写真利用について確認してください。登録後はこの端末に保存されます。</p>
    </div>

    <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="名前で検索" aria-label="名前で検索" />
    {loading ? <p className="muted">名簿を読み込み中…</p> : <div style={{ display: 'grid', gap: 8, maxHeight: 300, overflowY: 'auto' }}>
      {filtered.map((p) => <label key={p.participant_id} className="card" style={{ padding: 12, opacity: p.is_claimed ? .45 : 1, display: 'flex', gap: 10, alignItems: 'center' }}>
        <input type="radio" name="participant" value={p.participant_id} checked={selected === p.participant_id} disabled={p.is_claimed} onChange={() => setSelected(p.participant_id)} />
        <span style={{ fontWeight: 800 }}>{p.participant_name}</span>
        {p.is_claimed && <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>使用中</span>}
      </label>)}
      {!filtered.length && <p className="muted">該当する名前がありません。</p>}
    </div>}

    <section className="card" style={{ padding: 14, background: '#f6f3ff' }} aria-labelledby="consent-title">
      <strong id="consent-title">写真・プライバシーについて</strong>
      <ul style={{ margin: '10px 0', paddingLeft: 20, lineHeight: 1.7, fontSize: 13 }}>
        <li>投稿写真はOuting 2026参加者のGalleryから閲覧できます。</li>
        <li>「Stream」を選んだ写真は全体Streamにも即時表示されます。</li>
        <li>参加者は表示されている写真をダウンロードできます。</li>
        <li>写真は原則90日保存し、その後自動削除します。</li>
        <li>本人または運営は必要に応じて投稿を削除できます。</li>
      </ul>
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 800 }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
        <span>内容を確認し、Outing 2026での写真利用に同意します。</span>
      </label>
    </section>

    {error && <p style={{ color: '#c33', fontWeight: 700 }}>{error}</p>}
    <button className="btn primary" disabled={!selected || !consent || loading || submitting}>{submitting ? '登録中…' : '同意して参加'}</button>
  </form>
}
