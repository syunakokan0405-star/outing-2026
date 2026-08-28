'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Award = {
  id: string
  name: string
  description: string | null
}

type PostRow = {
  id: string
  image_path: string
  created_at: string
  comment: string | null
  participant_id: string
  participants?: { name: string } | null
}

export default function AdminAwardsPage() {
  const supabase = useMemo(() => createClient(), [])
  const eventId = process.env.NEXT_PUBLIC_EVENT_ID

  const [awards, setAwards] = useState<Award[]>([])
  const [posts, setPosts] = useState<PostRow[]>([])
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedAwardId, setSelectedAwardId] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!eventId) {
      setError('EVENT IDが設定されていません。')
      return
    }

    setLoading(true)
    setError('')

    const [awardResult, postResult] = await Promise.all([
      supabase
        .from('awards')
        .select('id,name,description')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false }),

      supabase
        .from('posts')
        .select(`
          id,
          image_path,
          created_at,
          comment,
          participant_id,
          participants!posts_participant_id_fkey(name)
        `)
        .eq('event_id', eventId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
    ])

    if (awardResult.error) {
      setError(awardResult.error.message)
      setLoading(false)
      return
    }

    if (postResult.error) {
      setError(postResult.error.message)
      setLoading(false)
      return
    }

    const awardRows = (awardResult.data ?? []) as Award[]
    const postRows = (postResult.data ?? []) as unknown as PostRow[]

    setAwards(awardRows)
    setPosts(postRows)

    if (!selectedAwardId && awardRows.length > 0) {
      setSelectedAwardId(awardRows[0].id)
    }

    const paths = postRows.map((post) => post.image_path)

    if (paths.length > 0) {
      const { data } = await supabase.storage
        .from('outing-photos')
        .createSignedUrls(paths, 3600)

      const map: Record<string, string> = {}

      data?.forEach((item, index) => {
        if (item.signedUrl) {
          map[paths[index]] = item.signedUrl
        }
      })

      setSignedUrls(map)
    }

    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  async function createAward() {
    if (!eventId) return

    if (!name.trim()) {
      setError('Award名を入力してください。')
      return
    }

    setError('')
    setMessage('')

    const { data, error: rpcError } = await supabase.rpc(
      'admin_create_award',
      {
        p_event_id: eventId,
        p_name: name.trim(),
        p_description: description.trim() || null,
      }
    )

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    setMessage('Awardを作成しました。')
    setName('')
    setDescription('')
    setSelectedAwardId(String(data))

    await load()
  }

  async function selectWinner(postId: string) {
    if (!selectedAwardId) {
      setError('Awardを選択してください。')
      return
    }

    setError('')
    setMessage('')

    const { error: rpcError } = await supabase.rpc(
      'admin_set_award_winner',
      {
        p_award_id: selectedAwardId,
        p_post_id: postId,
      }
    )

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    setMessage('受賞作品に追加しました。')
  }

  return (
    <main
      className="grid"
      style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: 24,
      }}
    >
      <div>
        <Link href="/admin" className="backLink">
          ← Dashboard
        </Link>

        <div className="brand" style={{ marginTop: 12 }}>
          OUTING 2026 ADMIN
        </div>

        <h1>Award管理</h1>

        <p className="muted">
          Awardを作成し、投稿写真から受賞作品を選択できます。
        </p>
      </div>

      {error && (
        <section className="card">
          <b style={{ color: '#d33' }}>エラー：{error}</b>
        </section>
      )}

      {message && (
        <section className="card">
          <b style={{ color: '#148558' }}>✓ {message}</b>
        </section>
      )}

      <section className="card grid">
        <h2>Awardを作成</h2>

        <input
          className="input"
          placeholder="例：ベストフォト賞"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <textarea
          className="input"
          rows={3}
          placeholder="説明（任意）"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <button
          className="btn primary"
          onClick={() => void createAward()}
        >
          ＋ Awardを作成
        </button>
      </section>

      <section className="card grid">
        <h2>受賞作品を選択</h2>

        <select
          className="input"
          value={selectedAwardId}
          onChange={(e) => setSelectedAwardId(e.target.value)}
        >
          <option value="">Awardを選択</option>

          {awards.map((award) => (
            <option key={award.id} value={award.id}>
              {award.name}
            </option>
          ))}
        </select>
      </section>

      {loading ? (
        <section className="card">
          <b>読み込み中...</b>
        </section>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit,minmax(260px,1fr))',
            gap: 16,
          }}
        >
          {posts.map((post) => (
            <article className="card" key={post.id}>
              {signedUrls[post.image_path] && (
                <img
                  src={signedUrls[post.image_path]}
                  alt="投稿写真"
                  style={{
                    width: '100%',
                    borderRadius: 16,
                    marginBottom: 12,
                  }}
                />
              )}

              <b>
                {post.participants?.name ?? '参加者'}
              </b>

              {post.comment && <p>{post.comment}</p>}

              <p className="muted">
                {new Date(post.created_at).toLocaleString('ja-JP')}
              </p>

              <button
                className="btn primary"
                onClick={() => void selectWinner(post.id)}
                disabled={!selectedAwardId}
              >
                🏆 この投稿を受賞作品にする
              </button>
            </article>
          ))}
        </div>
      )}
    </main>
  )
}