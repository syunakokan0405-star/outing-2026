'use client'

import Link from 'next/link'
import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { createClient } from '@/lib/supabase/client'

type AdminContext = {
  id: string
  event_id: string
  display_name: string
}

type StreamPost = {
  id: string
  created_by: string | null
  title: string
  body: string | null
  image_path: string | null
  created_at: string
  admin_users?: {
    display_name: string
  } | null
}

export default function AdminStream() {
  const supabase = useMemo(() => createClient(), [])

  const [admin, setAdmin] = useState<AdminContext | null>(null)
  const [posts, setPosts] = useState<StreamPost[]>([])
  const [signedUrls, setSignedUrls] =
    useState<Record<string, string>>({})

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')

  const [sending, setSending] = useState(false)
  const [loadingPosts, setLoadingPosts] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function loadPosts(eventId: string) {
    setLoadingPosts(true)

    const { data, error: loadError } = await supabase
      .from('stream_posts')
      .select(`
        id,
        created_by,
        title,
        body,
        image_path,
        created_at,
        admin_users!stream_posts_created_by_fkey (
          display_name
        )
      `)
      .eq('event_id', eventId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (loadError) {
      setError(loadError.message)
      setLoadingPosts(false)
      return
    }

    const rows = (data ?? []) as unknown as StreamPost[]
    setPosts(rows)

    const paths = rows
      .map((post) => post.image_path)
      .filter(
        (path): path is string =>
          typeof path === 'string' && path.length > 0
      )

    if (paths.length === 0) {
      setSignedUrls({})
      setLoadingPosts(false)
      return
    }

    const { data: urlData, error: urlError } =
      await supabase.storage
        .from('outing-photos')
        .createSignedUrls(paths, 3600)

    if (urlError) {
      console.error(urlError)
    }

    const map: Record<string, string> = {}

    urlData?.forEach((item, index) => {
      if (item.signedUrl) {
        map[paths[index]] = item.signedUrl
      }
    })

    setSignedUrls(map)
    setLoadingPosts(false)
  }

  useEffect(() => {
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError('運営ログインが必要です。')
        setLoadingPosts(false)
        return
      }

      const { data, error: adminError } = await supabase
        .from('admin_users')
        .select('id,event_id,display_name')
        .eq('auth_user_id', user.id)
        .maybeSingle()

      if (adminError || !data) {
        setError(
          'Streamを管理できる運営アカウントではありません。'
        )
        setLoadingPosts(false)
        return
      }

      setAdmin(data)
      await loadPosts(data.event_id)
    })()
  }, [supabase])

  useEffect(() => {
    return () => {
      if (preview) {
        URL.revokeObjectURL(preview)
      }
    }
  }, [preview])

  function chooseFile(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.files?.[0] ?? null

    if (preview) {
      URL.revokeObjectURL(preview)
    }

    setFile(next)
    setPreview(next ? URL.createObjectURL(next) : '')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()

    if (!admin || !title.trim() || sending) return

    setSending(true)
    setError('')
    setMessage('')

    let imagePath: string | null = null

    if (file) {
      if (!file.type.startsWith('image/')) {
        setError('画像ファイルを選択してください。')
        setSending(false)
        return
      }

      if (file.size > 12 * 1024 * 1024) {
        setError('画像は12MB以下にしてください。')
        setSending(false)
        return
      }

      const ext =
        (file.name.split('.').pop() || 'jpg')
          .replace(/[^a-zA-Z0-9]/g, '')
          .toLowerCase() || 'jpg'

      imagePath =
        `${admin.event_id}/admin/` +
        `${crypto.randomUUID()}.${ext}`

      const { error: uploadError } =
        await supabase.storage
          .from('outing-photos')
          .upload(imagePath, file, {
            contentType: file.type,
            upsert: false,
          })

      if (uploadError) {
        setError(uploadError.message)
        setSending(false)
        return
      }
    }

    const { error: insertError } = await supabase.rpc(
      'create_admin_stream_post',
      {
        p_event_id: admin.event_id,
        p_title: title.trim(),
        p_body: body.trim() || null,
        p_image_path: imagePath,
      }
    )

    if (insertError) {
      if (imagePath) {
        await supabase.storage
          .from('outing-photos')
          .remove([imagePath])
      }

      setError(insertError.message)
      setSending(false)
      return
    }

    setTitle('')
    setBody('')
    setFile(null)

    if (preview) {
      URL.revokeObjectURL(preview)
    }

    setPreview('')
    setMessage('Streamへ公開しました。')
    setSending(false)

    await loadPosts(admin.event_id)
  }

  async function deletePost(post: StreamPost) {
    if (!admin || deletingId) return

    const confirmed = window.confirm(
      `「${post.title}」を削除しますか？`
    )

    if (!confirmed) return

    setDeletingId(post.id)
    setError('')
    setMessage('')

    const { error: deleteError } = await supabase.rpc(
      'delete_admin_stream_post',
      {
        p_stream_post_id: post.id,
      }
    )

    if (deleteError) {
      setError(deleteError.message)
      setDeletingId(null)
      return
    }

    if (post.image_path) {
      const { error: storageError } =
        await supabase.storage
          .from('outing-photos')
          .remove([post.image_path])

      if (storageError) {
        console.error(storageError)
        setMessage(
          '投稿は削除しましたが、画像ファイルを削除できませんでした。'
        )
      } else {
        setMessage('Stream投稿を削除しました。')
      }
    } else {
      setMessage('Stream投稿を削除しました。')
    }

    setDeletingId(null)
    await loadPosts(admin.event_id)
  }

  return (
    <main
      style={{
        maxWidth: 900,
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

        <h1>Stream管理</h1>

        <p className="muted">
          お知らせ・Night Event・Pickupなどを
          参加者のStreamへ公開できます。
        </p>
      </div>

      {error && (
        <div className="statusError">
          {error}
        </div>
      )}

      {message && (
        <div className="statusSuccess">
          {message}
        </div>
      )}

      <form
        className="card adminForm"
        onSubmit={submit}
      >
        <h2>新規投稿</h2>

        <label>
          <b>タイトル</b>
        </label>

        <input
          className="postInput"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={80}
          required
          placeholder="例：Night Eventスタート！"
        />

        <label>
          <b>本文</b>{' '}
          <span className="muted">（任意）</span>
        </label>

        <textarea
          className="postInput"
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={500}
          placeholder="集合場所や結果など"
        />

        <label>
          <b>写真</b>{' '}
          <span className="muted">（任意）</span>
        </label>

        <input
          type="file"
          accept="image/*"
          onChange={chooseFile}
        />

        {preview && (
          <img
            className="adminPreview"
            src={preview}
            alt="投稿予定のプレビュー"
          />
        )}

        <button
          className="btn primary"
          disabled={!admin || sending || !title.trim()}
        >
          {sending
            ? '公開中...'
            : '📢 Streamへ公開'}
        </button>
      </form>

      <section>
        <h2>過去のStream投稿</h2>
      </section>

      {loadingPosts ? (
        <section className="card">
          <b>読み込み中...</b>
        </section>
      ) : posts.length === 0 ? (
        <section className="card">
          <p className="muted">
            まだStream投稿はありません。
          </p>
        </section>
      ) : (
        <div className="grid">
          {posts.map((post) => (
            <article className="card" key={post.id}>
              {post.image_path &&
                signedUrls[post.image_path] && (
                  <img
                    src={signedUrls[post.image_path]}
                    alt={post.title}
                    style={{
                      width: '100%',
                      maxHeight: 420,
                      objectFit: 'cover',
                      borderRadius: 16,
                      marginBottom: 14,
                    }}
                  />
                )}

              <h3>{post.title}</h3>

              {post.body && <p>{post.body}</p>}

              <p className="muted">
                投稿者：
                {post.admin_users?.display_name ?? '運営'}
                {' / '}
                {new Date(post.created_at).toLocaleString(
                  'ja-JP'
                )}
              </p>

              <button
                type="button"
                className="btn outline"
                style={{ color: '#d33' }}
                disabled={deletingId === post.id}
                onClick={() => void deletePost(post)}
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