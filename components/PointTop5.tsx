'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Trophy } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type RankRow = {
  rank: number
  participant_id: string
  participant_name: string
  score: number
  avatar_path: string | null
  avatar_url: string
}

type PointTop5Cache = {
  rows: RankRow[]
  rankingBackgroundUrl: string
}

let pointTop5Cache: PointTop5Cache | null = null

export default function PointTop5() {
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<RankRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rankingBackgroundUrl, setRankingBackgroundUrl] =
 
 useState('/mission-default.jpg')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const { data: authData } = await supabase.auth.getUser()

    if (!authData.user) {
      setError('参加者ログイン後にランキングを表示できます。')
      setLoading(false)
      return
    }

    const { data: participant, error: participantError } =
      await supabase
        .from('participants')
        .select('event_id')
        .eq('auth_user_id', authData.user.id)
        .maybeSingle()

    if (participantError || !participant) {
      setError('参加者情報を取得できませんでした。')
      setLoading(false)
      return
    }
const { data: eventData } = await supabase
  .from('events')
  .select('ranking_background_path')
  .eq('id', participant.event_id)
  .maybeSingle()

const rankingBackgroundPath =
  eventData?.ranking_background_path ?? ''

let nextRankingBackgroundUrl =
  pointTop5Cache?.rankingBackgroundUrl ??
  '/mission-default.jpg'

if (rankingBackgroundPath) {
  const { data: backgroundData } = await supabase.storage
    .from('outing-photos')
    .createSignedUrl(
      rankingBackgroundPath,
      60 * 60,
    )

  if (backgroundData?.signedUrl) {
    nextRankingBackgroundUrl =
      `${backgroundData.signedUrl}&t=${Date.now()}`
    setRankingBackgroundUrl(nextRankingBackgroundUrl)
  }
} else {
  nextRankingBackgroundUrl = '/mission-default.jpg'
  setRankingBackgroundUrl(nextRankingBackgroundUrl)
}
    const { data, error: rankError } =
      await supabase.rpc('get_event_top5', {
        p_event_id: participant.event_id,
      })

    if (rankError) {
      setError(rankError.message)
      setLoading(false)
      return
    }

    const rankRows = (data ?? []).map((row: any) => ({
      rank: Number(row.rank),
      participant_id: row.participant_id as string,
      participant_name: row.participant_name as string,
      score: Number(row.score ?? 0),
    }))

    if (!rankRows.length) {
      pointTop5Cache = {
        rows: [],
        rankingBackgroundUrl: nextRankingBackgroundUrl,
      }
      setRows([])
      setLoading(false)
      return
    }

    const ids = rankRows.map((row: any) => row.participant_id)

    const { data: participantRows, error: avatarError } =
      await supabase
        .from('participants')
        .select('id,avatar_path')
        .in('id', ids)

    if (avatarError) {
      setError(avatarError.message)
      setLoading(false)
      return
    }

    const avatarPathMap = new Map<string, string | null>()

    ;(participantRows ?? []).forEach((row: any) => {
      avatarPathMap.set(row.id, row.avatar_path ?? null)
    })

 const avatarPaths: string[] = [
  ...new Set<string>(
    rankRows
      .map((row: any) =>
        avatarPathMap.get(row.participant_id),
      )
      .filter(
        (path: string | null | undefined): path is string =>
          typeof path === 'string' && path.length > 0,
      ),
  ),
]

const avatarUrlMap = new Map<string, string>()

if (avatarPaths.length) {
  const { data: signedData } = await supabase.storage
    .from('outing-photos')
    .createSignedUrls(avatarPaths, 60 * 60)

  ;(signedData ?? []).forEach((entry, index) => {
    const path = avatarPaths[index]

    if (entry.signedUrl && path) {
      avatarUrlMap.set(path, entry.signedUrl)
    }
  })
}

    const nextRows = rankRows.map((row: any) => {
      const avatarPath =
        avatarPathMap.get(row.participant_id) ?? null

      return {
        ...row,
        avatar_path: avatarPath,
        avatar_url: avatarPath
          ? avatarUrlMap.get(avatarPath) ?? ''
          : '',
      }
    })

    pointTop5Cache = {
      rows: nextRows,
      rankingBackgroundUrl: nextRankingBackgroundUrl,
    }

    setRows(nextRows)
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    void load()

    const channel = supabase
      .channel('home-point-ranking')
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
          table: 'participants',
        },
        () => void load(),
      )
      .subscribe()

    const timer = window.setInterval(
      () => void load(),
      15000,
    )

    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      void supabase.removeChannel(channel)
    }
  }, [load, supabase])

  return (
    <section
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 22,
        padding: 16,
      
backgroundImage: `linear-gradient(
  135deg,
  rgba(10,10,16,.82),
  rgba(13,9,24,.70)
), url("${rankingBackgroundUrl}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        border: '1px solid rgba(255,255,255,.10)',
        boxShadow:
          '0 18px 45px rgba(0,0,0,.24)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(to bottom, rgba(0,0,0,.05), rgba(0,0,0,.28))',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 14,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 750,
              letterSpacing: '.12em',
              color: 'rgba(255,255,255,.68)',
            }}
          >
            POINT RANKING TOP 5
          </span>

          <Trophy
            size={17}
            strokeWidth={1.7}
            color="#c4b5fd"
          />
        </div>

        {loading && (
          <p
            style={{
              margin: 0,
              color: 'rgba(255,255,255,.62)',
              fontSize: 13,
            }}
          >
            ランキングを読み込み中…
          </p>
        )}

        {!loading && error && (
          <p
            style={{
              margin: 0,
              color: 'rgba(255,255,255,.62)',
              fontSize: 13,
            }}
          >
            {error}
          </p>
        )}

        {!loading && !error && !rows.length && (
          <p
            style={{
              margin: 0,
              color: 'rgba(255,255,255,.62)',
              fontSize: 13,
            }}
          >
            まだ得点がありません。
          </p>
        )}

        {!loading && !error && !!rows.length && (
          <div
            style={{
              display: 'grid',
              gap: 3,
            }}
          >
            {rows.map((row) => (
              <Link
                key={row.participant_id}
                href={`/profile/${row.participant_id}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    '26px 38px minmax(0,1fr) auto',
                  alignItems: 'center',
                  gap: 9,
                  minHeight: 54,
                  padding: '7px 5px',
                  textDecoration: 'none',
                  color: '#fff',
                  borderBottom:
                    '1px solid rgba(255,255,255,.08)',
                }}
              >
                <span
                  style={{
                    fontSize:
                      row.rank === 1 ? 18 : 15,
                    fontWeight: 800,
                    color:
                      row.rank === 1
                        ? '#ddd2ff'
                        : 'rgba(255,255,255,.62)',
                  }}
                >
                  {row.rank}
                </span>

                <span
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    overflow: 'hidden',
                    display: 'grid',
                    placeItems: 'center',
                    background:
                      'rgba(255,255,255,.10)',
                    border:
                      '1px solid rgba(255,255,255,.12)',
                    fontSize: 12,
                    fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  {row.avatar_url ? (
                    <img
                      src={row.avatar_url}
                      alt={`${row.participant_name}のプロフィール画像`}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                  ) : (
                    row.participant_name.slice(0, 1)
                  )}
                </span>

                <span
                  style={{
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 14,
                    fontWeight: 650,
                    textShadow:
                      '0 1px 8px rgba(0,0,0,.45)',
                  }}
                >
                  {row.participant_name}
                </span>

                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 750,
                    color:
                      row.rank === 1
                        ? '#ddd2ff'
                        : 'rgba(255,255,255,.74)',
                  }}
                >
                  {row.score} pt
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}