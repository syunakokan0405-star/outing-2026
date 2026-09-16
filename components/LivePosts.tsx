'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Download,
  Heart,
  Images,
  Pencil,
  Trash2,
  UsersRound,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Mode = 'stream' | 'gallery'

type PostRow = {
  id: string
  event_id: string
  participant_id: string
  mission_id: string | null
  image_path: string
  storage_provider: 'supabase' | 'r2'
  r2_object_key: string | null
  comment: string | null
  visibility: 'stream' | 'gallery'
  created_at: string
  participants?: {
    name: string
    avatar_path: string | null
  } | null
  missions?: {
    title: string
    points: number
    difficulty: string
  } | null
  reactions?: { participant_id: string }[]
  post_mentions?: {
    participant_id: string
    participants?: {
    name: string
    avatar_path: string | null
  } | null
  }[]
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
  avatarUrl: string
  heartCount: number
  mine: boolean
}

type AdminFeedItem = AdminStreamRow & {
  kind: 'admin'
  signedUrl: string
}

type FeedItem = UserFeedItem | AdminFeedItem

type LivePostsCacheEntry = {
  items: FeedItem[]
  currentParticipantId: string | null
  currentEventId: string | null
  hasMore: boolean
  savedAt: number
}

const livePostsCache = new Map<string, LivePostsCacheEntry>()


async function signedUrlMap(
  supabase: ReturnType<typeof createClient>,
  paths: string[],
) {
  const unique = [...new Set(paths.filter(Boolean))]

  if (!unique.length) {
    return new Map<string, string>()
  }

  const { data, error } = await supabase.storage
    .from('outing-photos')
    .createSignedUrls(unique, 60 * 60)

  if (error) {
    return new Map<string, string>()
  }

  const map = new Map<string, string>()

  ;(data ?? []).forEach((entry, index) => {
    if (entry.signedUrl) {
      map.set(unique[index], entry.signedUrl)
    }
  })

  return map
}

async function r2ReadUrlMap(posts: PostRow[]) {
  const postIds = posts
    .filter(
      (post) =>
        post.storage_provider === 'r2' &&
        post.r2_object_key,
    )
    .map((post) => post.id)

  if (!postIds.length) {
    return new Map<string, string>()
  }

  try {
    const response = await fetch('/api/r2/read-urls', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        postIds,
      }),
    })

    if (!response.ok) {
      return new Map<string, string>()
    }

    const data = (await response.json()) as {
      urls?: Record<string, string>
    }

    return new Map<string, string>(
      Object.entries(data.urls ?? {}),
    )
  } catch {
    return new Map<string, string>()
  }
}

export default function LivePosts({
  mode,
  participantId,
}: {
  mode: Mode
  participantId?: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const cacheKey = `${mode}:${participantId ?? 'self'}`
  const initialCache = livePostsCache.get(cacheKey)

  const [items, setItems] = useState<FeedItem[]>(
    () => initialCache?.items ?? [],
  )
  const [loading, setLoading] = useState(
    () => !initialCache,
  )
  const [error, setError] = useState('')
  const [currentParticipantId, setCurrentParticipantId] =
    useState<string | null>(
      () => initialCache?.currentParticipantId ?? null,
    )
  const [currentEventId, setCurrentEventId] =
    useState<string | null>(
      () => initialCache?.currentEventId ?? null,
    )
  const [hasMore, setHasMore] = useState(
    () => initialCache?.hasMore ?? false,
  )
  const [loadingMore, setLoadingMore] = useState(false)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    const cached = livePostsCache.get(cacheKey)
    if (!cached?.items.length) {
      setLoading(true)
    }
    setError('')

    const { data: authData } = await supabase.auth.getUser()
    const authUser = authData.user

    if (!authUser) {
      setError(
        'ログイン情報がありません。先に名前を選択してください。',
      )
      setLoading(false)
      return
    }

    const {
      data: participant,
      error: participantError,
    } = await supabase
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
    setCurrentEventId(participant.event_id)

    let query = supabase
      .from('posts')
      .select(`
        id,
        event_id,
        participant_id,
        mission_id,
        image_path,
        storage_provider,
        r2_object_key,
        comment,
        visibility,
        created_at,
        participants!posts_participant_id_fkey(name,avatar_path),
        missions(title,points,difficulty),
        reactions(participant_id),
        post_mentions(
          participant_id,
          participants(name)
        )
      `)
      .eq('event_id', participant.event_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(mode === 'stream' ? 30 : 120)

    if (mode === 'stream') {
      query = query.eq('visibility', 'stream')
    }

    if (mode === 'gallery') {
      query = query.eq(
        'participant_id',
        participantId ?? participant.id,
      )
    }

    const [
      { data: postsData, error: postsError },
      adminResult,
    ] = await Promise.all([
      query,

      mode === 'stream'
        ? supabase
            .from('stream_posts')
            .select(`
              id,
              event_id,
              title,
              body,
              image_path,
              created_at,
              admin_users(display_name)
            `)
            .eq('event_id', participant.event_id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(40)
        : Promise.resolve({
            data: [] as AdminStreamRow[],
            error: null,
          }),
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

    const rows =
      (postsData ?? []) as unknown as PostRow[]

    const adminRows =
      (adminResult.data ?? []) as unknown as AdminStreamRow[]

    const paths = [
      ...rows
        .filter((row) => row.storage_provider !== 'r2')
        .map((row) => row.image_path),
      ...rows
        .map((row) => row.participants?.avatar_path ?? '')
        .filter(Boolean),
      ...adminRows
        .map((row) => row.image_path ?? '')
        .filter(Boolean),
    ]

    const [urls, r2Urls] = await Promise.all([
      signedUrlMap(supabase, paths),
      r2ReadUrlMap(rows),
    ])

    const participantItems: UserFeedItem[] =
      rows.map((post) => ({
        ...post,
        kind: 'participant',
        signedUrl:
          post.storage_provider === 'r2'
            ? (r2Urls.get(post.id) ?? '')
            : (urls.get(post.image_path) ?? ''),
        avatarUrl: post.participants?.avatar_path
          ? (urls.get(post.participants.avatar_path) ?? '')
          : '',
        heartCount: post.reactions?.length ?? 0,
        mine: post.participant_id === participant.id,
      }))

    const adminItems: AdminFeedItem[] =
      adminRows.map((post) => ({
        ...post,
        kind: 'admin',
        signedUrl: post.image_path
          ? (urls.get(post.image_path) ?? '')
          : '',
      }))

    const merged: FeedItem[] = [
      ...participantItems,
      ...adminItems,
    ].sort(
      (a, b) =>
        new Date(b.created_at).getTime() -
        new Date(a.created_at).getTime(),
    )

    const nextHasMore =
      mode === 'stream' && rows.length === 30

    livePostsCache.set(cacheKey, {
      items: merged,
      currentParticipantId: participant.id,
      currentEventId: participant.event_id,
      hasMore: nextHasMore,
      savedAt: Date.now(),
    })

    setItems(merged)
    setHasMore(nextHasMore)
    setLoading(false)
  }, [cacheKey, mode, participantId, supabase])

  const loadMore = useCallback(async () => {
    if (mode !== 'stream' || !currentEventId || !currentParticipantId || loadingMore || !hasMore) return

    const participantItems = items.filter(
      (item): item is UserFeedItem => item.kind === 'participant',
    )
    const oldest = participantItems[participantItems.length - 1]
    if (!oldest) return

    setLoadingMore(true)
    try {
      const { data, error: moreError } = await supabase
        .from('posts')
        .select(`
          id,event_id,participant_id,mission_id,image_path,storage_provider,r2_object_key,
          comment,visibility,created_at,
          participants!posts_participant_id_fkey(name,avatar_path),
          missions(title,points,difficulty),
          reactions(participant_id),
          post_mentions(participant_id,participants(name))
        `)
        .eq('event_id', currentEventId)
        .eq('visibility', 'stream')
        .is('deleted_at', null)
        .lt('created_at', oldest.created_at)
        .order('created_at', { ascending: false })
        .limit(30)

      if (moreError) {
        setError(moreError.message)
        return
      }

      const rows = (data ?? []) as unknown as PostRow[]
      const paths = [
        ...rows.filter((row) => row.storage_provider !== 'r2').map((row) => row.image_path),
        ...rows.map((row) => row.participants?.avatar_path ?? '').filter(Boolean),
      ]
      const [urls, r2Urls] = await Promise.all([
        signedUrlMap(supabase, paths),
        r2ReadUrlMap(rows),
      ])
      const nextItems: UserFeedItem[] = rows.map((post) => ({
        ...post,
        kind: 'participant',
        signedUrl: post.storage_provider === 'r2'
          ? (r2Urls.get(post.id) ?? '')
          : (urls.get(post.image_path) ?? ''),
        avatarUrl: post.participants?.avatar_path
          ? (urls.get(post.participants.avatar_path) ?? '')
          : '',
        heartCount: post.reactions?.length ?? 0,
        mine: post.participant_id === currentParticipantId,
      }))

      setItems((current) => {
        const known = new Set(current.map((item) => `${item.kind}:${item.id}`))
        return [...current, ...nextItems.filter((item) => !known.has(`participant:${item.id}`))]
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      })
      setHasMore(rows.length === 30)
    } finally {
      setLoadingMore(false)
    }
  }, [currentEventId, currentParticipantId, hasMore, items, loadingMore, mode, supabase])

  useEffect(() => {
    if (mode !== 'stream' || !hasMore) return
    const target = loadMoreRef.current
    if (!target) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore()
      },
      { rootMargin: '500px 0px' },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasMore, loadMore, mode])

  const addRealtimePost = useCallback(async (postId: string) => {
    if (mode !== 'stream' || !currentEventId || !currentParticipantId) return

    const { data, error: postError } = await supabase
      .from('posts')
      .select(`
        id,event_id,participant_id,mission_id,image_path,storage_provider,r2_object_key,
        comment,visibility,created_at,
        participants!posts_participant_id_fkey(name,avatar_path),
        missions(title,points,difficulty),
        reactions(participant_id),
        post_mentions(participant_id,participants(name))
      `)
      .eq('id', postId)
      .eq('event_id', currentEventId)
      .eq('visibility', 'stream')
      .is('deleted_at', null)
      .maybeSingle()

    if (postError || !data) return
    const post = data as unknown as PostRow
    const paths = [
      ...(post.storage_provider !== 'r2' ? [post.image_path] : []),
      post.participants?.avatar_path ?? '',
    ].filter(Boolean)
    const [urls, r2Urls] = await Promise.all([
      signedUrlMap(supabase, paths),
      r2ReadUrlMap([post]),
    ])
    const nextItem: UserFeedItem = {
      ...post,
      kind: 'participant',
      signedUrl: post.storage_provider === 'r2'
        ? (r2Urls.get(post.id) ?? '')
        : (urls.get(post.image_path) ?? ''),
      avatarUrl: post.participants?.avatar_path
        ? (urls.get(post.participants.avatar_path) ?? '')
        : '',
      heartCount: post.reactions?.length ?? 0,
      mine: post.participant_id === currentParticipantId,
    }

    setItems((current) => {
      if (current.some((item) => item.kind === 'participant' && item.id === nextItem.id)) return current
      return [nextItem, ...current].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
    })
  }, [currentEventId, currentParticipantId, mode, supabase])

  const refreshPostHearts = useCallback(
    async (postId: string) => {
      if (!postId) return

      const { data, error: reactionError } = await supabase
        .from('reactions')
        .select('participant_id')
        .eq('post_id', postId)

      if (reactionError) return

      const reactions = (data ?? []) as {
        participant_id: string
      }[]

      setItems((current) =>
        current.map((item) => {
          if (
            item.kind !== 'participant' ||
            item.id !== postId
          ) {
            return item
          }

          return {
            ...item,
            reactions,
            heartCount: reactions.length,
          }
        }),
      )
    },
    [supabase],
  )

  useEffect(() => {
    if (loading) return

    livePostsCache.set(cacheKey, {
      items,
      currentParticipantId,
      currentEventId,
      hasMore,
      savedAt: Date.now(),
    })
  }, [
    cacheKey,
    currentEventId,
    currentParticipantId,
    hasMore,
    items,
    loading,
  ])

  const loadRef = useRef(load)

  useEffect(() => {
    loadRef.current = load
  }, [load])

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let loadingNow = false
    let reloadQueued = false

    const runLoad = async () => {
      if (disposed) return

      if (loadingNow) {
        reloadQueued = true
        return
      }

      loadingNow = true

      try {
        await loadRef.current()
      } finally {
        loadingNow = false

        if (!disposed && reloadQueued) {
          reloadQueued = false
          void runLoad()
        }
      }
    }

    const scheduleLoad = () => {
      if (disposed) return

      if (timer) {
        clearTimeout(timer)
      }

      timer = setTimeout(() => {
        timer = null
        void runLoad()
      }, 400)
    }

    void runLoad()

    const channel = supabase
      .channel(
        `outing-${mode}-${participantId ?? 'self'}`,
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'posts',
        },
        (payload) => {
          const postId = String((payload.new as { id?: string }).id ?? '')
          if (postId) void addRealtimePost(postId)
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'posts',
        },
        scheduleLoad,
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'posts',
        },
        scheduleLoad,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reactions',
        },
        (payload) => {
          const nextRow = payload.new as {
            post_id?: string
          }
          const oldRow = payload.old as {
            post_id?: string
          }
          const postId = String(
            nextRow?.post_id ?? oldRow?.post_id ?? '',
          )

          if (postId) {
            void refreshPostHearts(postId)
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'stream_posts',
        },
        scheduleLoad,
      )
      .subscribe()

    return () => {
      disposed = true

      if (timer) {
        clearTimeout(timer)
      }

      void supabase.removeChannel(channel)
    }
  }, [
    addRealtimePost,
    mode,
    participantId,
    refreshPostHearts,
    supabase,
  ])

  async function toggleHeart(post: UserFeedItem) {
    if (post.mine) return

    const { error: heartError } = await supabase.rpc(
      'toggle_heart',
      {
        p_post_id: post.id,
      },
    )

    if (heartError) {
      setError(heartError.message)
      return
    }

    void refreshPostHearts(post.id)
  }

  async function downloadPhoto(post: UserFeedItem) {
    if (post.storage_provider === 'r2') {
      if (!post.signedUrl) {
        setError('ダウンロードURLを作成できませんでした。')
        return
      }
      window.location.assign(post.signedUrl)
      return
    }

    const { data, error: downloadError } =
      await supabase.storage
        .from('outing-photos')
        .createSignedUrl(post.image_path, 60, { download: true })

    if (downloadError || !data?.signedUrl) {
      setError(
        downloadError?.message ??
          'ダウンロードURLを作成できませんでした。',
      )
      return
    }
    window.location.assign(data.signedUrl)
  }

  async function editComment(post: UserFeedItem) {
    if (!post.mine) return

    const next = window.prompt(
      'コメントを編集（30文字まで）',
      post.comment ?? '',
    )

    if (next === null) return

    if (next.length > 30) {
      setError('コメントは30文字までです。')
      return
    }

    const { error: editError } = await supabase.rpc(
      'edit_post_comment',
      {
        p_post_id: post.id,
        p_comment: next,
      },
    )

    if (editError) {
      setError(editError.message)
    } else {
      void load()
    }
  }

  async function deletePost(post: UserFeedItem) {
    if (!post.mine) return

    const confirmed = window.confirm(
      'この写真を削除しますか？ 初回CLEARで獲得したポイントも取り消されます。',
    )

    if (!confirmed) return

    if (post.storage_provider === 'r2') {
      const response = await fetch('/api/r2/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          postId: post.id,
        }),
      })

      if (!response.ok) {
        const body = await response
          .json()
          .catch(() => ({
            error: '投稿を削除できませんでした。',
          }))

        setError(
          body?.error ??
            '投稿を削除できませんでした。',
        )
        return
      }

      void load()
      return
    }

    const { error: deleteError } = await supabase.rpc(
      'delete_post',
      {
        p_post_id: post.id,
      },
    )

    if (deleteError) {
      setError(deleteError.message)
      return
    }

    const { error: storageError } =
      await supabase.storage
        .from('outing-photos')
        .remove([post.image_path])

    if (storageError) {
      setError(
        '投稿は削除しましたが、画像ファイルを削除できませんでした。運営に確認してください。',
      )
    }

    void load()
  }

  if (loading) {
    return (
      <section
        className="glassCardStrong"
        style={{
          padding: '28px 20px',
          textAlign: 'center',
        }}
      >
        <p
          className="uiMuted"
          style={{ margin: 0 }}
        >
          写真を読み込み中...
        </p>
      </section>
    )
  }

  if (error) {
    return (
      <section
        className="glassCardStrong"
        style={{
          padding: 20,
        }}
      >
        <p className="uiEyebrow">
          ERROR
        </p>

        <h2
          style={{
            margin: '6px 0 8px',
            fontSize: 17,
          }}
        >
          表示できませんでした
        </h2>

        <p className="uiMuted">
          {error}
        </p>

        <button
          type="button"
          className="uiGhostButton"
          onClick={() => void load()}
          style={{
            marginTop: 10,
          }}
        >
          再読み込み
        </button>
      </section>
    )
  }

  if (!items.length) {
    return (
      <section
        className="glassCardStrong"
        style={{
          padding: '32px 20px',
          textAlign: 'center',
        }}
      >
        <Images
          size={27}
          strokeWidth={1.5}
          style={{
            opacity: 0.5,
          }}
        />

        <h2
          style={{
            margin: '14px 0 6px',
            fontSize: 18,
          }}
        >
          {mode === 'stream'
            ? 'Streamはまだ空です'
            : 'Galleryはまだ空です'}
        </h2>

        <p
          className="uiMuted"
          style={{ margin: 0 }}
        >
          最初の写真を投稿してみよう。
        </p>
      </section>
    )
  }

 return (
    <div
      className="outingSans"
      style={
        mode === 'gallery'

          ? {
              display: 'grid',
              gridTemplateColumns:
                'repeat(2, minmax(0, 1fr))',
              gap: 8,
            }
          : {
              display: 'grid',
              gap: 24,
            }
      }
    >
      {items.map((item) => {
        /*
         * 運営投稿
         */
        if (item.kind === 'admin') {
          return (
            <article
              key={`admin-${item.id}`}
              className="glassCardStrong"
              style={{
                overflow: 'hidden',
              }}
            >
              {item.signedUrl && (
                <div
                  style={{
                    position: 'relative',
                    aspectRatio: '4 / 5',
                    overflow: 'hidden',
                  }}
                >
                  <img
                    src={item.signedUrl}
                    alt="運営からの投稿写真"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />

                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background:
                        'linear-gradient(to bottom, transparent 45%, rgba(0,0,0,.72) 100%)',
                    }}
                  />

                  <span
                    style={{
                      position: 'absolute',
                      left: 14,
                      bottom: 14,
                      padding: '6px 9px',
                      borderRadius: 999,
                      background:
                        'rgba(139,92,246,.82)',
                      color: '#fff',
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: '.08em',
                      backdropFilter:
                        'blur(10px)',
                    }}
                  >
                    OUTING STAFF
                  </span>
                </div>
              )}

              <div
                style={{
                  padding: 16,
                }}
              >
                {!item.signedUrl && (
                  <span
                    style={{
                      display: 'inline-flex',
                      marginBottom: 10,
                      padding: '6px 9px',
                      borderRadius: 999,
                      background:
                        'rgba(139,92,246,.18)',
                      color: '#c4b5fd',
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: '.08em',
                    }}
                  >
                    OUTING STAFF
                  </span>
                )}

                <h2
                  style={{
                    margin: 0,
                    color: '#fff',
                    fontSize: 19,
                    lineHeight: 1.4,
                  }}
                >
                  {item.title}
                </h2>

                {item.body && (
                  <p
                    style={{
                      margin: '10px 0 0',
                      color:
                        'rgba(255,255,255,.68)',
                      fontSize: 13,
                      lineHeight: 1.75,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {item.body}
                  </p>
                )}

                <div
                  style={{
                    display: 'flex',
                    justifyContent:
                      'space-between',
                    gap: 12,
                    marginTop: 14,
                    color:
                      'rgba(255,255,255,.42)',
                    fontSize: 11,
                  }}
                >
                  <strong
                    style={{
                      color:
                        'rgba(255,255,255,.72)',
                    }}
                  >
                    {item.admin_users
                      ?.display_name ??
                      '運営'}
                  </strong>

                  <span>
                    {new Date(
                      item.created_at,
                    ).toLocaleString(
                      'ja-JP',
                      {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      },
                    )}
                  </span>
                </div>
              </div>
            </article>
          )
        }

        /*
         * 参加者投稿
         */
        const post = item

        /*
         * Galleryでは写真を主役にした
         * 2列グリッドだけ表示
         */
        if (mode === 'gallery') {
          return (
            <article
              key={post.id}
              style={{
                position: 'relative',
                aspectRatio: '1 / 1',
                overflow: 'hidden',
                borderRadius: 16,
                background:
                  'rgba(255,255,255,.05)',
                border:
                  '1px solid rgba(255,255,255,.08)',
              }}
            >
              {post.signedUrl ? (
                <img
                  src={post.signedUrl}
                  alt={`${
                    post.participants
                      ?.name ??
                    '参加者'
                  }の投稿写真`}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              ) : (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'grid',
                    placeItems: 'center',
                    padding: 12,
                    color:
                      'rgba(255,255,255,.4)',
                    fontSize: 11,
                    textAlign: 'center',
                  }}
                >
                  写真を表示できませんでした
                </div>
              )}

              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background:
                    'linear-gradient(to bottom, transparent 55%, rgba(0,0,0,.65) 100%)',
                  pointerEvents: 'none',
                }}
              />

              <div
                style={{
                  position: 'absolute',
                  left: 10,
                  right: 10,
                  bottom: 9,
                  display: 'flex',
                  justifyContent:
                    'space-between',
                  alignItems: 'center',
                  gap: 8,
                  color: '#fff',
                  fontSize: 10,
                  pointerEvents: 'none',
                }}
              >
                <strong
                  style={{
                    overflow: 'hidden',
                    textOverflow:
                      'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {post.participants
                    ?.name ??
                    'Participant'}
                </strong>

                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    flexShrink: 0,
                  }}
                >
                  <Heart
                    size={11}
                    strokeWidth={2}
                  />
                  {post.heartCount}
                </span>
              </div>
            </article>
          )
        }

        /*
         * Stream
         */
        return (
          <article
            key={post.id}
            className="glassCardStrong"
            style={{
              overflow: 'hidden',
            }}
          >
            {/* 投稿者 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent:
                  'space-between',
                gap: 12,
                padding: '13px 14px',
              }}
            >
              <Link
                href={
                  post.mine
                    ? '/me'
                    : `/profile/${post.participant_id}`
                }
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  minWidth: 0,
                  color: '#fff',
                  textDecoration: 'none',
                }}
              >
                <span
                  className="uiAvatar"
                  style={{
                    width: 34,
                    height: 34,
                    flexShrink: 0,
                    display: 'grid',
                    placeItems: 'center',
                    overflow: 'hidden',
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  {post.avatarUrl ? (
                    <img
                      src={post.avatarUrl}
                      alt={`${post.participants?.name ?? '参加者'}のプロフィール画像`}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                  ) : (
                    (post.participants?.name ?? 'P').slice(0, 1)
                  )}
                </span>

                <span
                  style={{
                    minWidth: 0,
                  }}
                >
                  <strong
                    style={{
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow:
                        'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: 13,
                    }}
                  >
                    {post.participants
                      ?.name ??
                      'Participant'}
                  </strong>

                  <span
                    style={{
                      display: 'block',
                      marginTop: 2,
                      color:
                        'rgba(255,255,255,.42)',
                      fontSize: 10,
                    }}
                  >
                    {new Date(
                      post.created_at,
                    ).toLocaleString(
                      'ja-JP',
                      {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      },
                    )}
                  </span>
                </span>
              </Link>

              {post.mine && (
                <span
                  style={{
                    color:
                      'rgba(255,255,255,.38)',
                    fontSize: 10,
                    letterSpacing:
                      '.08em',
                  }}
                >
                  YOUR POST
                </span>
              )}
            </div>

            {/* 写真 */}
            <div
              style={{
                position: 'relative',
                width: '100%',
                background: '#090a0d',
              }}
            >
              {post.signedUrl ? (
                <img
                  src={post.signedUrl}
                  alt={`${
                    post.participants
                      ?.name ??
                    '参加者'
                  }の投稿写真`}
                  style={{
                    width: '100%',
                    maxHeight: 620,
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              ) : (
                <div
                  style={{
                    minHeight: 360,
                    display: 'grid',
                    placeItems: 'center',
                    color:
                      'rgba(255,255,255,.4)',
                    fontSize: 12,
                  }}
                >
                  写真を表示できませんでした
                </div>
              )}

              {post.missions && (
                <div
                  style={{
                    position: 'absolute',
                    left: 12,
                    right: 12,
                    bottom: 12,
                    display: 'flex',
                    justifyContent:
                      'space-between',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 11px',
                    borderRadius: 13,
                    background:
                      'rgba(10,10,14,.68)',
                    border:
                      '1px solid rgba(255,255,255,.10)',
                    backdropFilter:
                      'blur(12px)',
                  }}
                >
                  <span
                className="outingSerifJa"
                style={{
                      overflow: 'hidden',
                      textOverflow:
                        'ellipsis',
                      whiteSpace: 'nowrap',
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 650,
                    }}
                  >
                    {post.missions.title}
                  </span>

                  <strong
                    style={{
                      flexShrink: 0,
                      color: '#c4b5fd',
                      fontSize: 11,
                    }}
                  >
                    +{post.missions.points} PT
                  </strong>
                </div>
              )}
            </div>

         {/* 投稿情報 */}
<div
  style={{
    padding: '9px 14px 10px',
    background:
      'linear-gradient(180deg, rgba(10,10,15,.78), rgba(10,10,15,.62))',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
  }}
>
  {/* アクション */}
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      minHeight: 32,
      gap: 5,
    }}
  >
    <button
      type="button"
      disabled={post.mine}
      onClick={() => void toggleHeart(post)}
      title={
        post.mine
          ? '自分の投稿にはハートできません'
          : 'ハート'
      }
      style={{
        border: 0,
        background: 'transparent',
        color: post.mine
          ? 'rgba(255,255,255,.34)'
          : '#fff',
        padding: '3px 4px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        cursor: post.mine ? 'default' : 'pointer',
        fontSize: 12,
        fontWeight: 650,
      }}
    >
      <Heart size={20} strokeWidth={1.8} />
      {post.heartCount}
    </button>

    <button
      type="button"
      onClick={() => void downloadPhoto(post)}
      title="写真を保存"
      style={{
        border: 0,
        background: 'transparent',
        color: 'rgba(255,255,255,.76)',
        padding: 4,
        display: 'grid',
        placeItems: 'center',
        cursor: 'pointer',
      }}
    >
      <Download size={19} strokeWidth={1.7} />
    </button>

    <span
      style={{
        marginLeft: 'auto',
        padding: '4px 8px',
        borderRadius: 999,
        background: 'rgba(255,255,255,.06)',
        border: '1px solid rgba(255,255,255,.07)',
        color: 'rgba(255,255,255,.46)',
        fontSize: 9,
        textTransform: 'uppercase',
        letterSpacing: '.08em',
      }}
    >
      {post.visibility}
    </span>
  </div>

  {/* コメント */}
  {post.comment && (
    <p
      style={{
        margin: '5px 4px 0',
        color: 'rgba(255,255,255,.82)',
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      {post.comment}
    </p>
  )}

  {/* メンション */}
  {!!post.post_mentions?.length && (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        margin: '5px 4px 0',
        color: 'rgba(255,255,255,.48)',
        fontSize: 10,
        lineHeight: 1.4,
      }}
    >
      <UsersRound
        size={12}
        strokeWidth={1.7}
        style={{ flexShrink: 0 }}
      />

      <span>
        with{' '}
        {post.post_mentions
          .map(
            (mention) =>
              mention.participants?.name,
          )
          .filter(Boolean)
          .join(' ・ ')}
      </span>
    </div>
  )}

  {/* 自分の投稿操作 */}
  {post.mine && (
    <div
      style={{
        display: 'flex',
        gap: 12,
        marginTop: 7,
        paddingTop: 7,
        borderTop:
          '1px solid rgba(255,255,255,.055)',
      }}
    >
      <button
        type="button"
        onClick={() => void editComment(post)}
        style={{
          border: 0,
          background: 'transparent',
          color: 'rgba(255,255,255,.48)',
          padding: '2px 3px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          cursor: 'pointer',
          fontSize: 9,
        }}
      >
        <Pencil size={12} strokeWidth={1.7} />
        コメント編集
      </button>

      <button
        type="button"
        onClick={() => void deletePost(post)}
        style={{
          border: 0,
          background: 'transparent',
          color: 'rgba(255,130,130,.68)',
          padding: '2px 3px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          cursor: 'pointer',
          fontSize: 9,
        }}
      >
                   <Trash2 size={12} strokeWidth={1.7} />
        削除
      </button>
    </div>
  )}
</div>

</article>
        )
      })}

      {mode === 'stream' && (
        <div
          ref={loadMoreRef}
          style={{
            minHeight: 1,
            textAlign: 'center',
            color: 'rgba(255,255,255,.45)',
            fontSize: 11,
            padding: loadingMore ? '10px 0' : 0,
          }}
        >
          {loadingMore ? 'さらに読み込み中...' : ''}
        </div>
      )}
    </div>
  )
}