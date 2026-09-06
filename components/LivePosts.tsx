'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
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

    let query = supabase
      .from('posts')
      .select(`
        id,
        event_id,
        participant_id,
        mission_id,
        image_path,
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
      .limit(mode === 'stream' ? 80 : 120)

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
      ...rows.map((row) => row.image_path),
      ...rows
        .map((row) => row.participants?.avatar_path ?? '')
        .filter(Boolean),
      ...adminRows
        .map((row) => row.image_path ?? '')
        .filter(Boolean),
    ]

    const urls = await signedUrlMap(supabase, paths)

    const participantItems: UserFeedItem[] =
      rows.map((post) => ({
        ...post,
        kind: 'participant',
        signedUrl: urls.get(post.image_path) ?? '',
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

  useEffect(() => {
    void load()

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
        () => void load(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reactions',
        },
        () => void load(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'stream_posts',
        },
        () => void load(),
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [load, mode, participantId, supabase])

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
    const { data, error: downloadError } =
      await supabase.storage
        .from('outing-photos')
        .createSignedUrl(post.image_path, 60, {
          download: true,
        })

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
                padding:
                  '13px 14px 15px',
              }}
            >
              {/* アクション */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <button
                  type="button"
                  disabled={post.mine}
                  onClick={() =>
                    void toggleHeart(post)
                  }
                  title={
                    post.mine
                      ? '自分の投稿にはハートできません'
                      : 'ハート'
                  }
                  style={{
                    border: 0,
                    background:
                      'transparent',
                    color: post.mine
                      ? 'rgba(255,255,255,.34)'
                      : '#fff',
                    padding: '6px 5px',
                    display:
                      'inline-flex',
                    alignItems:
                      'center',
                    gap: 6,
                    cursor: post.mine
                      ? 'default'
                      : 'pointer',
                    fontSize: 13,
                    fontWeight: 650,
                  }}
                >
                  <Heart
                    size={21}
                    strokeWidth={1.8}
                  />
                  {post.heartCount}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void downloadPhoto(post)
                  }
                  title="写真を保存"
                  style={{
                    border: 0,
                    background:
                      'transparent',
                    color:
                      'rgba(255,255,255,.76)',
                    padding: 6,
                    display: 'grid',
                    placeItems:
                      'center',
                    cursor: 'pointer',
                  }}
                >
                  <Download
                    size={20}
                    strokeWidth={1.7}
                  />
                </button>

                <span
                  style={{
                    marginLeft: 'auto',
                    padding: '5px 8px',
                    borderRadius: 999,
                    background:
                      'rgba(255,255,255,.06)',
                    border:
                      '1px solid rgba(255,255,255,.07)',
                    color:
                      'rgba(255,255,255,.46)',
                    fontSize: 9,
                    textTransform:
                      'uppercase',
                    letterSpacing:
                      '.08em',
                  }}
                >
                  {post.visibility}
                </span>
              </div>

              {/* コメント */}
              {post.comment && (
                <p
                  style={{
                    margin: '8px 4px 0',
                    color:
                      'rgba(255,255,255,.82)',
                    fontSize: 13,
                    lineHeight: 1.65,
                  }}
                >
                  {post.comment}
                </p>
              )}

              {/* メンション */}
              {!!post.post_mentions
                ?.length && (
                <div
                  style={{
                    display: 'flex',
                    alignItems:
                      'flex-start',
                    gap: 6,
                    margin: '9px 4px 0',
                    color:
                      'rgba(255,255,255,.48)',
                    fontSize: 11,
                    lineHeight: 1.5,
                  }}
                >
                  <UsersRound
                    size={14}
                    strokeWidth={1.7}
                    style={{
                      flexShrink: 0,
                      marginTop: 1,
                    }}
                  />

                  <span>
                    with{' '}
                    {post.post_mentions
                      .map(
                        (mention) =>
                          mention
                            .participants
                            ?.name,
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
                    gap: 8,
                    marginTop: 13,
                    paddingTop: 12,
                    borderTop:
                      '1px solid rgba(255,255,255,.06)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() =>
                      void editComment(post)
                    }
                    style={{
                      border: 0,
                      background:
                        'transparent',
                      color:
                        'rgba(255,255,255,.55)',
                      padding: 4,
                      display:
                        'inline-flex',
                      alignItems:
                        'center',
                      gap: 5,
                      cursor: 'pointer',
                      fontSize: 10,
                    }}
                  >
                    <Pencil
                      size={13}
                      strokeWidth={1.7}
                    />
                    コメント編集
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      void deletePost(post)
                    }
                    style={{
                      border: 0,
                      background:
                        'transparent',
                      color:
                        'rgba(255,130,130,.72)',
                      padding: 4,
                      display:
                        'inline-flex',
                      alignItems:
                        'center',
                      gap: 5,
                      cursor: 'pointer',
                      fontSize: 10,
                    }}
                  >
                    <Trash2
                      size={13}
                      strokeWidth={1.7}
                    />
                    削除
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
