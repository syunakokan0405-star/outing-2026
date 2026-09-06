'use client'

import {
  ChangeEvent,
  useEffect,
  useMemo,
  useState,
} from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Image as ImageIcon,
  Upload,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type BackgroundType =
  | 'ranking'
  | 'announcement'
  | 'guide'

type BackgroundState = {
  ranking: string
  announcement: string
  guide: string
}

export default function HomeBackgroundsPage() {
  const supabase = useMemo(
    () => createClient(),
    [],
  )

  const eventId =
    process.env.NEXT_PUBLIC_EVENT_ID

  const [backgrounds, setBackgrounds] =
    useState<BackgroundState>({
      ranking: '',
      announcement: '',
      guide: '',
    })

  const [loading, setLoading] =
    useState(true)

  const [saving, setSaving] =
    useState<BackgroundType | null>(null)

  const [message, setMessage] =
    useState('')

  const [error, setError] =
    useState('')

  useEffect(() => {
    async function load() {
      if (!eventId) {
        setError(
          'NEXT_PUBLIC_EVENT_ID が設定されていません。',
        )
        setLoading(false)
        return
      }

      const {
        data,
        error: loadError,
      } = await supabase
        .from('events')
        .select(`
          ranking_background_path,
          announcement_background_path,
          guide_background_path
        `)
        .eq('id', eventId)
        .maybeSingle()

      if (loadError) {
        setError(loadError.message)
        setLoading(false)
        return
      }

      const rankingPath =
        data?.ranking_background_path ?? ''

      const announcementPath =
        data?.announcement_background_path ?? ''

      const guidePath =
        data?.guide_background_path ?? ''

      const paths = [
        rankingPath,
        announcementPath,
        guidePath,
      ].filter(Boolean)

      const urls =
        new Map<string, string>()

      if (paths.length) {
        const { data: signedData } =
          await supabase.storage
            .from('outing-photos')
            .createSignedUrls(
              paths,
              60 * 60,
            )

        ;(signedData ?? []).forEach(
          (entry, index) => {
            if (entry.signedUrl) {
              urls.set(
                paths[index],
                entry.signedUrl,
              )
            }
          },
        )
      }

      setBackgrounds({
        ranking: rankingPath
          ? urls.get(rankingPath) ?? ''
          : '',

        announcement: announcementPath
          ? urls.get(
              announcementPath,
            ) ?? ''
          : '',

        guide: guidePath
          ? urls.get(guidePath) ?? ''
          : '',
      })

      setLoading(false)
    }

    void load()
  }, [eventId, supabase])

  async function uploadBackground(
    type: BackgroundType,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file =
      event.target.files?.[0]

    event.target.value = ''

    if (!file || !eventId) return

    if (
      !file.type.startsWith('image/')
    ) {
      setError(
        '画像ファイルを選択してください。',
      )
      return
    }

    setSaving(type)
    setMessage('')
    setError('')

    const extension =
      file.name
        .split('.')
        .pop()
        ?.toLowerCase() ?? 'jpg'

    const storagePath =
      `event-backgrounds/${eventId}/${type}.${extension}`

    const {
      error: uploadError,
    } = await supabase.storage
      .from('outing-photos')
      .upload(
        storagePath,
        file,
        {
          upsert: true,
          contentType: file.type,
          cacheControl: '3600',
        },
      )

    if (uploadError) {
      setError(uploadError.message)
      setSaving(null)
      return
    }

    const {
      error: updateError,
    } = await supabase.rpc(
      'set_event_home_background',
      {
        p_event_id: eventId,
        p_type: type,
        p_storage_path:
          storagePath,
      },
    )

    if (updateError) {
      setError(updateError.message)
      setSaving(null)
      return
    }

    const {
      data: signedData,
      error: signedError,
    } = await supabase.storage
      .from('outing-photos')
      .createSignedUrl(
        storagePath,
        60 * 60,
      )

    if (
      signedError ||
      !signedData?.signedUrl
    ) {
      setError(
        signedError?.message ??
          'プレビューURLを取得できませんでした。',
      )
      setSaving(null)
      return
    }

    setBackgrounds(
      (current) => ({
        ...current,

        [type]:
          `${signedData.signedUrl}&t=${Date.now()}`,
      }),
    )

    const successMessages:
      Record<
        BackgroundType,
        string
      > = {
      ranking:
        'ランキング背景を更新しました。',
      announcement:
        'Announcement背景を更新しました。',
      guide:
        'Guide写真を更新しました。',
    }

    setMessage(
      successMessages[type],
    )

    setSaving(null)
  }

  const cards: {
    type: BackgroundType
    title: string
    description: string
  }[] = [
    {
      type: 'ranking',
      title: 'Point Ranking',
      description:
        'HOMEのランキング背景',
    },
    {
      type: 'announcement',
      title: 'Announcement',
      description:
        'HOMEのお知らせ背景',
    },
    {
      type: 'guide',
      title: 'Guide Hero',
      description:
        'Guide上部のメイン写真',
    },
  ]

  return (
    <main
      style={{
        maxWidth: 1000,
        margin: '0 auto',
        padding: 24,
      }}
      className="grid"
    >
      <div>
        <Link
          href="/admin"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 16,
          }}
        >
          <ArrowLeft size={16} />
          Admin Dashboard
        </Link>

        <div className="brand">
          OUTING 2026
        </div>

        <h1>表示画像設定</h1>

        <p className="muted">
          参加者画面で使用する写真を変更できます。
        </p>
      </div>

      {message && (
        <section className="card">
          <strong>
            {message}
          </strong>
        </section>
      )}

      {error && (
        <section className="card">
          <strong>
            エラー
          </strong>

          <p>{error}</p>
        </section>
      )}

      {loading ? (
        <section className="card">
          読み込み中...
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
          {cards.map(
            (card) => (
              <section
                key={card.type}
                className="card"
              >
                <div
                  style={{
                    position:
                      'relative',

                    aspectRatio:
                      '16 / 9',

                    overflow:
                      'hidden',

                    borderRadius:
                      14,

                    marginBottom:
                      16,

                    background:
                      '#111',
                  }}
                >
                  {backgrounds[
                    card.type
                  ] ? (
                    <img
                      src={
                        backgrounds[
                          card.type
                        ]
                      }
                      alt=""
                      style={{
                        width:
                          '100%',

                        height:
                          '100%',

                        objectFit:
                          'cover',

                        display:
                          'block',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width:
                          '100%',

                        height:
                          '100%',

                        display:
                          'grid',

                        placeItems:
                          'center',

                        color:
                          'rgba(255,255,255,.4)',
                      }}
                    >
                      <ImageIcon
                        size={32}
                        strokeWidth={
                          1.5
                        }
                      />
                    </div>
                  )}
                </div>

                <h2>
                  {card.title}
                </h2>

                <p className="muted">
                  {
                    card.description
                  }
                </p>

                <label
                  className="btn primary"
                  style={{
                    display:
                      'inline-flex',

                    alignItems:
                      'center',

                    justifyContent:
                      'center',

                    gap: 7,

                    cursor:
                      saving ===
                      card.type
                        ? 'wait'
                        : 'pointer',
                  }}
                >
                  <Upload
                    size={16}
                  />

                  {saving ===
                  card.type
                    ? 'アップロード中...'
                    : '画像を選択'}

                  <input
                    type="file"
                    accept="image/*"
                    disabled={
                      saving !==
                      null
                    }
                    onChange={(
                      event,
                    ) =>
                      void uploadBackground(
                        card.type,
                        event,
                      )
                    }
                    style={{
                      display:
                        'none',
                    }}
                  />
                </label>
              </section>
            ),
          )}
        </div>
      )}
    </main>
  )
}
