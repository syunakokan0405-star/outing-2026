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

  const [items, setItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [currentParticipantId, setCurrentParticipantId] =
    useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const { data: authData } = await supabase.auth.getUser()
    const authUser = authData.user

    if (!authUser) {
      setError(
        '繝ｭ繧ｰ繧､繝ｳ諠・ｱ縺後≠繧翫∪縺帙ｓ縲ょ・縺ｫ蜷榊燕繧帝∈謚槭＠縺ｦ縺上□縺輔＞縲・,
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
      setError('蜿ょ刈閠・ュ蝣ｱ繧貞叙蠕励〒縺阪∪縺帙ｓ縺ｧ縺励◆縲・)
      setLoading(false)
      return
    }

    setCurrentParticipantId(participant.id)

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

    setItems(merged)
    setLoading(false)
  }, [mode, participantId, supabase])

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
          event: '*',
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
        scheduleLoad,
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
  }, [mode, participantId, supabase])

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
    } else {
      void load()
    }
  }

  async function downloadPhoto(post: UserFeedItem) {
    if (post.storage_provider === 'r2') {
      if (!post.signedUrl) {
        setError('繝繧ｦ繝ｳ繝ｭ繝ｼ繝蔚RL繧剃ｽ懈・縺ｧ縺阪∪縺帙ｓ縺ｧ縺励◆縲・)
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
          '繝繧ｦ繝ｳ繝ｭ繝ｼ繝蔚RL繧剃ｽ懈・縺ｧ縺阪∪縺帙ｓ縺ｧ縺励◆縲・,
      )
      return
    }
    window.location.assign(data.signedUrl)
  }

  async function editComment(post: UserFeedItem) {
    if (!post.mine) return

    const next = window.prompt(
      '繧ｳ繝｡繝ｳ繝医ｒ邱ｨ髮・ｼ・0譁・ｭ励∪縺ｧ・・,
      post.comment ?? '',
    )

    if (next === null) return

    if (next.length > 30) {
      setError('繧ｳ繝｡繝ｳ繝医・30譁・ｭ励∪縺ｧ縺ｧ縺吶・)
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
      '縺薙・蜀咏悄繧貞炎髯､縺励∪縺吶°・・蛻晏屓CLEAR縺ｧ迯ｲ蠕励＠縺溘・繧､繝ｳ繝医ｂ蜿悶ｊ豸医＆繧後∪縺吶・,
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
            error: '謚慕ｨｿ繧貞炎髯､縺ｧ縺阪∪縺帙ｓ縺ｧ縺励◆縲・,
          }))

        setError(
          body?.error ??
            '謚慕ｨｿ繧貞炎髯､縺ｧ縺阪∪縺帙ｓ縺ｧ縺励◆縲・,
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
        '謚慕ｨｿ縺ｯ蜑企勁縺励∪縺励◆縺後∫判蜒上ヵ繧｡繧､繝ｫ繧貞炎髯､縺ｧ縺阪∪縺帙ｓ縺ｧ縺励◆縲る°蝟ｶ縺ｫ遒ｺ隱阪＠縺ｦ縺上□縺輔＞縲・,
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
          蜀咏悄繧定ｪｭ縺ｿ霎ｼ縺ｿ荳ｭ...
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
          陦ｨ遉ｺ縺ｧ縺阪∪縺帙ｓ縺ｧ縺励◆
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
          蜀崎ｪｭ縺ｿ霎ｼ縺ｿ
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
            ? 'Stream縺ｯ縺ｾ縺遨ｺ縺ｧ縺・
            : 'Gallery縺ｯ縺ｾ縺遨ｺ縺ｧ縺・}
        </h2>

        <p
          className="uiMuted"
          style={{ margin: 0 }}
        >
          譛蛻昴・蜀咏悄繧呈兜遞ｿ縺励※縺ｿ繧医≧縲・
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
         * 驕句霧謚慕ｨｿ
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
                    alt="驕句霧縺九ｉ縺ｮ謚慕ｨｿ蜀咏悄"
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
                      '驕句霧'}
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
         * 蜿ょ刈閠・兜遞ｿ
         */
        const post = item

        /*
         * Gallery縺ｧ縺ｯ蜀咏悄繧剃ｸｻ蠖ｹ縺ｫ縺励◆
         * 2蛻励げ繝ｪ繝・ラ縺縺題｡ｨ遉ｺ
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
                    '蜿ょ刈閠・
                  }縺ｮ謚慕ｨｿ蜀咏悄`}
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
                  蜀咏悄繧定｡ｨ遉ｺ縺ｧ縺阪∪縺帙ｓ縺ｧ縺励◆
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
            {/* 謚慕ｨｿ閠・*/}
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
                      alt={`${post.participants?.name ?? '蜿ょ刈閠・}縺ｮ繝励Ο繝輔ぅ繝ｼ繝ｫ逕ｻ蜒汁}
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

            {/* 蜀咏悄 */}
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
                    '蜿ょ刈閠・
                  }縺ｮ謚慕ｨｿ蜀咏悄`}
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
                  蜀咏悄繧定｡ｨ遉ｺ縺ｧ縺阪∪縺帙ｓ縺ｧ縺励◆
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

         {/* 謚慕ｨｿ諠・ｱ */}
<div
  style={{
    padding: '9px 14px 10px',
    background:
      'linear-gradient(180deg, rgba(10,10,15,.78), rgba(10,10,15,.62))',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
  }}
>
  {/* 繧｢繧ｯ繧ｷ繝ｧ繝ｳ */}
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
          ? '閾ｪ蛻・・謚慕ｨｿ縺ｫ縺ｯ繝上・繝医〒縺阪∪縺帙ｓ'
          : '繝上・繝・
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
      title="蜀咏悄繧剃ｿ晏ｭ・
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

  {/* 繧ｳ繝｡繝ｳ繝・*/}
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

  {/* 繝｡繝ｳ繧ｷ繝ｧ繝ｳ */}
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
          .join(' 繝ｻ ')}
      </span>
    </div>
  )}

  {/* 閾ｪ蛻・・謚慕ｨｿ謫堺ｽ・*/}
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
        繧ｳ繝｡繝ｳ繝育ｷｨ髮・
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
        蜑企勁
      </button>
    </div>
  )}
</div>

</article>
        )
      })}
    </div>
  )
}
