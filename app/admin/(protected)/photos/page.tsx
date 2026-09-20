'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type PostRow = {
  id: string
  comment: string | null
  visibility: string
  created_at: string
  participant_id: string
  storage_provider: string
  r2_object_key: string | null
  r2_thumbnail_key: string | null
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
  const [imageUrls, setImageUrls] =
    useState<Record<string, string>>({})
  const [deletingId, setDeletingId] =
    useState<string | null>(null)

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
        comment,
        visibility,
        created_at,
        participant_id,
        storage_provider,
        r2_object_key,
        r2_thumbnail_key,
        participants!posts_participant_id_fkey(name),
        missions!posts_mission_id_fkey(title)
      `)
      .eq('event_id', eventId)
      .eq('storage_provider', 'r2')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (postsError) {
      setError(postsError.message)
      setLoading(false)
      return
    }

    const rows = (data ?? []) as unknown as PostRow[]
    setPosts(rows)

    if (rows.length === 0) {
      setImageUrls({})
      setLoading(false)
      return
    }

    try {
      const response = await fetch('/api/r2/read-urls', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          postIds: rows.map((post) => post.id),
        }),
      })

      if (!response.ok) {
        const body = await response
          .json()
          .catch(() => null)

        throw new Error(
          body?.error ?? 'R2画像を取得できませんでした。',
        )
      }

      const body = (await response.json()) as {
        urls?: Record<string, string>
      }

      setImageUrls(body.urls ?? {})
    } catch (loadError) {
      console.error('R2 image load error:', loadError)

      setImageUrls({})
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'R2画像を取得できませんでした。',
      )
    }

    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  async function deletePost(postId: string) {
    const confirmed = window.confirm(
      'この投稿を削除しますか？\n関連するポイントやMission CLEARも取り消される場合があります。',
    )

    if (!confirmed) return

    setDeletingId(postId)
    setError('')

    try {
      const response = await fetch('/api/r2/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          postId,
        }),
      })

      const body = await response
        .json()
        .catch(() => null)

      if (!response.ok) {
        setError(
          body?.error ??
            '投稿を削除できませんでした。',
        )
        return
      }

      await load()
    } catch (deleteError) {
      console.error(
        'R2 post delete error:',
        deleteError,
      )

      setError('投稿を削除できませんでした。')
    } finally {
      setDeletingId(null)
    }
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

        <div
          className="brand"
          style={{ marginTop: 12 }}
        >
          OUTING 2026 ADMIN
        </div>

        <h1>写真管理</h1>

        <p className="muted">
          参加者の投稿写真を確認・削除できます。
        </p>
      </div>

      {error && (
        <section className="card">
          <b style={{ color: '#d33' }}>
            {error}
          </b>
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
              {imageUrls[post.id] ? (
                <img
                  src={imageUrls[post.id]}
                  alt="投稿写真"
                  loading="lazy"
                  decoding="async"
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
                <b>
                  {post.participants?.name ??
                    '参加者'}
                </b>
              </div>

              {post.missions?.title && (
                <div className="muted">
                  Mission: {post.missions.title}
                </div>
              )}

              <div className="muted">
                公開先:{' '}
                {post.visibility === 'stream'
                  ? 'Stream'
                  : 'Gallery'}
              </div>

              <div className="muted">
                {new Date(
                  post.created_at,
                ).toLocaleString('ja-JP')}
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
                onClick={() =>
                  void deletePost(post.id)
                }
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