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
}

export default function PointTop5() {
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<RankRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

    const { data, error: rankError } =
      await supabase.rpc('get_event_top5', {
        p_event_id: participant.event_id,
      })

    if (rankError) {
      setError(rankError.message)
      setLoading(false)
      return
    }

    setRows(
      (data ?? []).map((row: any) => ({
        rank: Number(row.rank),
        participant_id: row.participant_id,
        participant_name: row.participant_name,
        score: Number(row.score ?? 0),
      })),
    )

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
        padding: 16,
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
            color: 'rgba(255,255,255,.58)',
          }}
        >
          POINT RANKING TOP 5
        </span>

        <Trophy
          size={17}
          strokeWidth={1.7}
          color="#a78bfa"
        />
      </div>

      {loading && (
        <p
          style={{
            margin: 0,
            color: 'rgba(255,255,255,.55)',
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
            color: 'rgba(255,255,255,.55)',
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
            color: 'rgba(255,255,255,.55)',
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
            gap: 2,
          }}
        >
          {rows.map((row) => (
            <Link
              key={row.participant_id}
              href={`/profile/${row.participant_id}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '30px minmax(0,1fr) auto',
                alignItems: 'center',
                gap: 10,
                minHeight: 48,
                padding: '8px 4px',
                textDecoration: 'none',
                color: '#fff',
                borderBottom:
                  '1px solid rgba(255,255,255,.07)',
              }}
            >
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 750,
                  color:
                    row.rank === 1
                      ? '#d8c9ff'
                      : 'rgba(255,255,255,.58)',
                }}
              >
                {String(row.rank).padStart(2, '0')}
              </span>

              <span
                style={{
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 14,
                  fontWeight: 650,
                }}
              >
                {row.participant_name}
              </span>

              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'rgba(255,255,255,.68)',
                }}
              >
                {row.score} pt
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}