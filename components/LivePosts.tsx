'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Mode = 'stream' | 'gallery'

type PostRow = {
  id: string
  event_id: string
  participant_id: string
  mission_id: string | null
  image_path: string
  comment: string | null
  visibility: 'stream' | 'gallery'
  created_at: string
  participants?: { name: string } | null
  missions?: { title: string; points: number; difficulty: string } | null
  reactions?: { participant_id: string }[]
  post_mentions?: { participant_id: string; participants?: { name: string } | null }[]
}

type AdminStreamRow = {
  id: string
  event_id: string
  title: string
  body: string | null
  image_path: string | null
  created_at: string
  admin_users?: { display_name: string } | null
}

type UserFeedItem = PostRow & {
  kind: 'participant'
  signedUrl: string
  heartCount: number
  mine: boolean
}

type AdminFeedItem = AdminStreamRow & {
  kind: 'admin'
  signedUrl: string
}

type FeedItem = UserFeedItem | AdminFeedItem

async function signedUrlMap(
  supabase: ReturnType<typeof createClient>,
  paths: string[],
) {
  const unique = [...new Set(paths.filter(Boolean))]
  if (!unique.length) return new Map<string, string>()

  const { data, error } = await supabase.storage
    .from('outing-photos')
    .createSignedUrls(unique, 60 * 60)

  if (error) return new Map<string, string>()

  const map = new Map<string, string>()
  ;(data ?? []).forEach((entry, index) => {
    if (entry.signedUrl) map.set(unique[index], entry.signedUrl)
  })
  return map
}

export default function LivePosts({
  mode,
  participantId,
}: {
  mode: Mode
  participantId?: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const [items, setItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [currentParticipantId, setCurrentParticipantId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const { data: authData } = await supabase.auth.getUser()
    const authUser = authData.user
    if (!authUser) {
      setError('ログイン情報がありません。先に名前を選択してください。')
      setLoading(false)
      return
    }

    const { data: participant, error: participantError } = await supabase
      .from('participants')
      .select('id,event_id,name')
      .eq('auth_user_id', authUser.id)
      .maybeSingle()

    if (participantError || !participant) {
      setError('参加者情報を取得できませんでした。')
      setLoading(false)
      return
    }

    setCurrentParticipantId(participant.id)

    let query = supabase
      .from('posts')
      .select(`
        id,event_id,participant_id,mission_id,image_path,comment,visibility,created_at,
        participants!posts_participant_id_fkey(name),
        missions(title,points,difficulty),
        reactions(participant_id),
        post_mentions(participant_id,participants(name))
      `)
      .eq('event_id', participant.event_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(mode === 'stream' ? 80 : 120)

    if (mode === 'stream') query = query.eq('visibility', 'stream')
    if (mode === 'gallery') query = query.eq('participant_id', participantId ?? participant.id)

    const [{ data: postsData, error: postsError }, adminResult] = await Promise.all([
      query,
      mode === 'stream'
        ? supabase
            .from('stream_posts')
            .select('id,event_id,title,body,image_path,created_at,admin_users(display_name)')
            .eq('event_id', participant.event_id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(40)
        : Promise.resolve({ data: [] as AdminStreamRow[], error: null }),
    ])

    if (postsError) {
      setError(postsError.message)
      setLoading(false)
      return
    }
    if (adminResult.error) {
      setError(adminResult.error.message)
      setLoading(false)
      return
    }

    const rows = (postsData ?? []) as unknown as PostRow[]
    const adminRows = (adminResult.data ?? []) as unknown as AdminStreamRow[]
    const paths = [
      ...rows.map(row => row.image_path),
      ...adminRows.map(row => row.image_path ?? '').filter(Boolean),
    ]
    const urls = await signedUrlMap(supabase, paths)

    const participantItems: UserFeedItem[] = rows.map(post => ({
      ...post,
      kind: 'participant',
      signedUrl: urls.get(post.image_path) ?? '',
      heartCount: post.reactions?.length ?? 0,
      mine: post.participant_id === participant.id,
    }))

    const adminItems: AdminFeedItem[] = adminRows.map(post => ({
      ...post,
      kind: 'admin',
      signedUrl: post.image_path ? (urls.get(post.image_path) ?? '') : '',
    }))

    const merged: FeedItem[] = [...participantItems, ...adminItems]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    setItems(merged)
    setLoading(false)
  }, [mode, participantId, supabase])

  useEffect(() => {
    void load()

    const channel = supabase
      .channel(`outing-${mode}-${participantId ?? 'self'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stream_posts' }, () => void load())
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [load, mode, participantId, supabase])

  async function toggleHeart(post: UserFeedItem) {
    if (post.mine) return
    const { error: heartError } = await supabase.rpc('toggle_heart', { p_post_id: post.id })
    if (heartError) setError(heartError.message)
    else void load()
  }


  async function downloadPhoto(post: UserFeedItem) {
    const { data, error: downloadError } = await supabase.storage
      .from('outing-photos')
      .createSignedUrl(post.image_path, 60, { download: true })
    if (downloadError || !data?.signedUrl) {
      setError(downloadError?.message ?? 'ダウンロードURLを作成できませんでした。')
      return
    }
    window.location.assign(data.signedUrl)
  }

  async function editComment(post: UserFeedItem) {
    if (!post.mine) return
    const next = window.prompt('コメントを編集（30文字まで）', post.comment ?? '')
    if (next === null) return
    if (next.length > 30) {
      setError('コメントは30文字までです。')
      return
    }
    const { error: editError } = await supabase.rpc('edit_post_comment', {
      p_post_id: post.id,
      p_comment: next,
    })
    if (editError) setError(editError.message)
    else void load()
  }

  async function deletePost(post: UserFeedItem) {
    if (!post.mine) return
    if (!window.confirm('この写真を削除しますか？初回CLEARの得点も取り消されます。')) return
    const { error: deleteError } = await supabase.rpc('delete_post', {
      p_post_id: post.id,
     
    })
    if (deleteError) {
      setError(deleteError.message)
      return
    }

    const { error: storageError } = await supabase.storage.from('outing-photos').remove([post.image_path])
    if (storageError) {
      setError('投稿は削除しましたが、画像ファイルの削除を完了できませんでした。運営に確認してください。')
    }
    void load()
  }

  if (loading) return <section className="card"><b>写真を読み込み中…</b></section>
  if (error) return <section className="card"><b>表示できませんでした</b><p className="muted">{error}</p><button className="btn outline" onClick={() => void load()}>再読み込み</button></section>
  if (!items.length) return <section className="card"><b>{mode === 'stream' ? 'Streamはまだ空です' : 'Galleryはまだ空です'}</b><p className="muted">最初の写真を投稿してみよう。</p></section>

  return <div className={mode === 'gallery' ? 'galleryGrid' : 'feedGrid'}>
    {items.map(item => {
      if (item.kind === 'admin') {
        return <article key={`admin-${item.id}`} className="adminStreamCard">
          {item.signedUrl && <img className="feedPhoto" src={item.signedUrl} alt="運営からの投稿写真" />}
          <div className="adminStreamBody">
            <span className="adminStreamBadge">OUTING STAFF</span>
            <h2>{item.title}</h2>
            {item.body && <p className="feedComment">{item.body}</p>}
            <div className="feedMeta"><b>{item.admin_users?.display_name ?? '運営'}</b><span>{new Date(item.created_at).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span></div>
          </div>
        </article>
      }

      const post = item
      return <article key={post.id} className={mode === 'gallery' ? 'galleryCard' : 'feedCard'}>
        <div className="feedPhotoWrap">
          {post.signedUrl ? <img className="feedPhoto" src={post.signedUrl} alt={`${post.participants?.name ?? '参加者'}の投稿写真`} /> : <div className="photoFallback">写真URLを取得できませんでした</div>}
          {post.missions && <div className="feedMission"><span>{post.missions.title}</span><b>+{post.missions.points}pt</b></div>}
        </div>
        <div className="feedBody">
          <div className="feedMeta">
            <Link className="profileLink" href={post.mine ? '/me' : `/profile/${post.participant_id}`}><b>{post.participants?.name ?? 'Participant'}</b></Link>
            <span>{new Date(post.created_at).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
          </div>
          {post.comment && <p className="feedComment">{post.comment}</p>}
          {!!post.post_mentions?.length && <p className="mentionsLine">with {post.post_mentions.map(m => m.participants?.name).filter(Boolean).join(' · ')}</p>}
          <div className="feedActions">
            <button className="heartButton" disabled={post.mine} onClick={() => void toggleHeart(post)} title={post.mine ? '自分の投稿にはハートできません' : 'ハート'}>♡ {post.heartCount}</button>
            <span className="visibilityBadge">{post.visibility === 'stream' ? 'Stream' : 'Gallery'}</span>
            <button className="downloadLink" type="button" onClick={() => void downloadPhoto(post)}>保存</button>
            {post.mine && <div className="ownerActions"><button onClick={() => void editComment(post)}>コメント編集</button><button className="deleteLink" onClick={() => void deletePost(post)}>削除</button></div>}
          </div>
        </div>
      </article>
    })}
  </div>
}
