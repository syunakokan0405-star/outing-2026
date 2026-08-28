'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type PostRow = {
  id: string
  image_path: string
  comment: string | null
  visibility: string
  created_at: string
  participant_id: string
  participants?: {
    name: string
  } | null
  missions?: {
    title: string
  } | null
}

export default function AdminPhotos() {
  const supabase = useMemo(() => createClient(), [])

  const [posts, setPosts] = useState<PostRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError('')

    const eventId = process.env.NEXT_PUBLIC_EVENT_ID

    if (!eventId) {
      setError('EVENT IDが設定されていません。')
      setLoading(false)
      return
    }

    const { data, error: postsError } = await supabase
      .from('posts')
      .select(`
        id,
        image_path,
        comment,
        visibility,
        created_at,
        participant_id,
      participants!posts_participant_id_fkey(name),
missions!posts_mission_id_fkey(title)
      `)
      .eq('event_id', eventId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (postsError) {
      setError(postsError.message)
      setLoading(false)
      return
    }

    const rows = (data ?? []) as unknown as PostRow[]
    setPosts(rows)

    const paths = rows.map((row) => row.image_path).filter(Boolean)

    if (paths.length > 0) {
      const { data: signedData } = await supabase.storage
        .from('outing-photos')
        .createSignedUrls(paths, 3600)

      const map: Record<string, string> = {}

      signedData?.forEach((item, index) => {
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

  async function deletePost(postId: string) {
    const confirmed = window.confirm(
      'この投稿を削除しますか？\n関連するポイントやMission CLEARも取り消される場合があります。'
    )

    if (!confirmed) return

    setDeletingId(postId)
    setError('')

    const { error: deleteError } = await supabase.rpc('delete_post', {
      p_post_id: postId,
    })

    if (deleteError) {
      setError(deleteError.message)
      setDeletingId(null)
      return
    }

    await load()
    setDeletingId(null)
  }

  return (
    <main
      style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: 24,
      }}
      className="grid"
    >
      <div>
        <Link className="backLink" href="/admin">
          ← Dashboard
        </Link>

        <div className="brand" style={{ marginTop: 12 }}>
          OUTING 2026 ADMIN
        </div>

        <h1>写真管理</h1>

        <p className="muted">
          参加者の投稿写真を確認・削除できます。
        </p>
      </div>

      {error && (
        <section className="card">
          <b style={{ color: '#d33' }}>{error}</b>
        </section>
      )}

      {loading ? (
        <section className="card">
          <b>読み込み中...</b>
        </section>
      ) : posts.length === 0 ? (
        <section className="card">
          <b>現在投稿はありません。</b>
        </section>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit,minmax(280px,1fr))',
            gap: 16,
          }}
        >
          {posts.map((post) => (
            <article className="card" key={post.id}>
              {signedUrls[post.image_path] ? (
                <img
                  src={signedUrls[post.image_path]}
                  alt="投稿写真"
                  style={{
                    width: '100%',
                    borderRadius: 16,
                    marginBottom: 12,
                  }}
                />
              ) : (
                <div className="muted">
                  写真を表示できません。
                </div>
              )}

              <div style={{ marginBottom: 8 }}>
                <b>{post.participants?.name ?? '参加者'}</b>
              </div>

              {post.missions?.title && (
                <div className="muted">
                  Mission: {post.missions.title}
                </div>
              )}

              <div className="muted">
                公開先: {post.visibility === 'stream' ? 'Stream' : 'Gallery'}
              </div>

              <div className="muted">
                {new Date(post.created_at).toLocaleString('ja-JP')}
              </div>

              {post.comment && (
                <p>{post.comment}</p>
              )}

              <button
                className="btn outline"
                style={{
                  marginTop: 12,
                  color: '#d33',
                }}
                onClick={() => void deletePost(post.id)}
                disabled={deletingId === post.id}
              >
                {deletingId === post.id
                  ? '削除中...'
                  : '削除'}
              </button>
            </article>
          ))}
        </div>
      )}
    </main>
  )
}