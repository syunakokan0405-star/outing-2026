'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Trophy } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getBrowserParticipant } from '@/lib/browser-participant'
import { storageImageUrlMap } from '@/lib/storage-image-urls'
import { avatarUrlMap, PROFILE_UPDATED_EVENT } from '@/lib/avatar-urls'

type RankRow = {
  rank: number
  participant_id: string
  participant_name: string
  score: number
  avatar_path: string | null
  avatar_url: string
}

type StoredRankRow = Omit<RankRow, 'avatar_url'>

type PointTop5Cache = {
  savedAt: number
  rows: StoredRankRow[]
  rankingBackgroundPath: string
}

const CACHE_VERSION = 'outing-point-top5-v3'
const memoryCache = new Map<string, PointTop5Cache>()

function cacheKey(eventId: string, userId: string) {
  return `${CACHE_VERSION}:${eventId}:${userId}`
}

function readCache(eventId: string, userId: string): PointTop5Cache | null {
  const key = cacheKey(eventId, userId)
  const memory = memoryCache.get(key)
  if (memory) return memory

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PointTop5Cache
    if (!parsed || !Array.isArray(parsed.rows)) return null
    memoryCache.set(key, parsed)
    return parsed
  } catch {
    return null
  }
}

function writeCache(
  eventId: string,
  userId: string,
  value: PointTop5Cache,
) {
  const key = cacheKey(eventId, userId)
  memoryCache.set(key, value)
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Cache failure must not break ranking.
  }
}

export default function PointTop5() {
  const supabase = useMemo(() => createClient(), [])
  const backgroundPathRef = useRef<string | null>(null)
  const [rows, setRows] = useState<RankRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rankingBackgroundUrl, setRankingBackgroundUrl] =
    useState('/mission-default.jpg')

  const load = useCallback(async () => {
    setError('')

    const participant = await getBrowserParticipant(supabase).catch(() => null)
    if (!participant) {
      setError('参加者情報を取得できませんでした。')
      setLoading(false)
      return
    }

    const eventId = participant.event_id
    const cached = readCache(eventId, participant.id)

    async function applyRankingBackground(path: string) {
      if (!path) { setRankingBackgroundUrl('/mission-default.jpg'); return }
      const urls = await storageImageUrlMap(supabase, [path])
      const url = urls.get(path)
      if (url) setRankingBackgroundUrl(url)
    }

    // Show cached text/background data immediately.
    // Signed URLs themselves are never persisted.
    if (cached) {
      void applyRankingBackground(cached.rankingBackgroundPath)

      setRows(
        cached.rows.map((row) => ({
          ...row,
          avatar_url: '',
        })),
      )
      setLoading(false)
    }

    try {
      // Ranking and event background metadata are independent.
      const [eventResult, rankResult] = await Promise.all([
        backgroundPathRef.current === null
          ? supabase.from('events').select('ranking_background_path').eq('id', eventId).maybeSingle()
          : Promise.resolve({ data: { ranking_background_path: backgroundPathRef.current }, error: null }),
        supabase.rpc('get_event_top5', {
          p_event_id: eventId,
        }),
      ])

      if (rankResult.error) throw rankResult.error

      const rankingBackgroundPath =
        eventResult.data?.ranking_background_path ?? ''

      if (!eventResult.error) backgroundPathRef.current = rankingBackgroundPath

      const rankRows = (rankResult.data ?? []).map((row: any) => ({
        rank: Number(row.rank),
        participant_id: row.participant_id as string,
        participant_name: row.participant_name as string,
        score: Number(row.score ?? 0),
      }))

      if (!rankRows.length) {
        writeCache(eventId, participant.id, {
          savedAt: Date.now(),
          rows: [],
          rankingBackgroundPath,
        })
        setRows([])
        setLoading(false)
        return
      }

      const ids = rankRows.map((row: any) => row.participant_id)

      const participantResult = await supabase.from('participants')
        .select('id,avatar_path').in('id', ids)
      if (participantResult.error) throw participantResult.error
      void applyRankingBackground(rankingBackgroundPath)

      const avatarPathMap = new Map<string, string | null>()
      ;(participantResult.data ?? []).forEach((row: any) => {
        avatarPathMap.set(row.id, row.avatar_path ?? null)
      })

      const resolvedAvatars = await avatarUrlMap(supabase, participantResult.data ?? [])

      const nextRows: RankRow[] = rankRows.map((row: any) => {
        const avatarPath =
          avatarPathMap.get(row.participant_id) ?? null

        return {
          ...row,
          avatar_path: avatarPath,
          avatar_url: avatarPath
            ? resolvedAvatars.get(avatarPath) ?? ''
            : '',
        }
      })

      writeCache(eventId, participant.id, {
        savedAt: Date.now(),
        rankingBackgroundPath,
        rows: nextRows.map(({ avatar_url, ...row }) => row),
      })

      setRows(nextRows)
      setError('')
      setLoading(false)
    } catch (loadError) {
      console.error(loadError)
      if (!cached) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'ランキングを読み込めませんでした。',
        )
      }
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    const isVisible = () => document.visibilityState !== 'hidden'
    let disposed = false
    let running = false
    let queued = false
    let debounce: ReturnType<typeof setTimeout> | undefined
    let lastRefresh = 0
    const refresh = async () => {
      if (disposed || !isVisible()) { queued = true; return }
      if (running) { queued = true; return }
      running = true
      queued = false
      try { await load(); lastRefresh = Date.now() }
      finally {
        running = false
        if (queued && !disposed && isVisible()) schedule()
      }
    }
    const schedule = () => {
      if (disposed) return
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => { debounce = undefined; void refresh() }, 500)
    }
    void refresh()
    const channel = supabase.channel('home-point-ranking')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'point_transactions' }, schedule)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events' }, () => { backgroundPathRef.current = null; schedule() })
      .subscribe()
    // Missed updates are recovered every five minutes while visible.
    const timer = window.setInterval(() => {
      backgroundPathRef.current = null
      schedule()
    }, 300_000)
    const onResume = () => {
      if (queued || Date.now() - lastRefresh >= 60_000) schedule()
    }
    window.addEventListener('focus', onResume)
    document.addEventListener('visibilitychange', onResume)
    window.addEventListener(PROFILE_UPDATED_EVENT, schedule)
    return () => {
      disposed = true
      window.clearInterval(timer)
      if (debounce) clearTimeout(debounce)
      window.removeEventListener('focus', onResume)
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener(PROFILE_UPDATED_EVENT, schedule)
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