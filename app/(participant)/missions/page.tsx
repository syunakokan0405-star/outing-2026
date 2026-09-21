'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  BookOpen,
  Check,
  HomeIcon,
  Images,
  Target,
  UserRound,
  Users,
  ArrowUpRight,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import PersistentMissionImage from '@/components/PersistentMissionImage'

type MissionItem = {
  assignmentId: string
  cleared: boolean
  id: string
  title: string
  difficulty: string | null
  points: number
  dropNumber: number
  requiredMentions: number
  imagePath: string | null
  imageUrl: string
}

type MissionCache = {
  savedAt: number
  participantId: string
  missions: Omit<MissionItem, 'imageUrl'>[]
}

const CACHE_PREFIX = 'outing-missions-v2'
const MEMORY_CACHE = new Map<string, MissionCache>()

function cacheKey(eventId: string, userId: string) {
  return `${CACHE_PREFIX}:${eventId}:${userId}`
}

function readCache(eventId: string, userId: string): MissionCache | null {
  const key = cacheKey(eventId, userId)
  const memory = MEMORY_CACHE.get(key)
  if (memory) return memory

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as MissionCache
    if (!parsed || !Array.isArray(parsed.missions)) return null
    MEMORY_CACHE.set(key, parsed)
    return parsed
  } catch {
    return null
  }
}

function writeCache(
  eventId: string,
  userId: string,
  value: MissionCache,
) {
  const key = cacheKey(eventId, userId)
  MEMORY_CACHE.set(key, value)

  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage can be unavailable/full; memory cache still works.
  }
}

export default function Missions() {
  const supabase = useMemo(() => createClient(), [])
  const searchParams = useSearchParams()
  const filter = searchParams.get('filter')

  const activeFilter =
    filter === 'clear'
      ? 'clear'
      : filter === 'unclear'
        ? 'unclear'
        : 'all'

  const eventId = process.env.NEXT_PUBLIC_EVENT_ID ?? ''

  const [missions, setMissions] = useState<MissionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!eventId) {
      setError('NEXT_PUBLIC_EVENT_ID が設定されていません。')
      setLoading(false)
      return
    }

    let cancelled = false

    async function attachImageUrls(
      baseMissions: Omit<MissionItem, 'imageUrl'>[],
    ) {
      const missionImagePaths = [
        ...new Set(
          baseMissions
            .map((mission) => mission.imagePath)
            .filter((path): path is string => Boolean(path)),
        ),
      ]

      const urlMap = new Map<string, string>()

      if (missionImagePaths.length > 0) {
        const { data: signedImages } = await supabase.storage
          .from('outing-photos')
          .createSignedUrls(missionImagePaths, 60 * 60)

        ;(signedImages ?? []).forEach((entry, index) => {
          if (entry.signedUrl) {
            urlMap.set(missionImagePaths[index], entry.signedUrl)
          }
        })
      }

      return baseMissions.map((mission) => ({
        ...mission,
        imageUrl: mission.imagePath
          ? urlMap.get(mission.imagePath) ?? '/mission-default.jpg'
          : '/mission-default.jpg',
      }))
    }

    async function load() {
      // Authenticate first so user-specific mission data can never leak
      // between accounts sharing the same browser/device.
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        window.location.replace('/join')
        return
      }

      // 1) Show only this user's previous mission data immediately.
      const cached = readCache(eventId, user.id)

      if (cached?.missions?.length) {
        const cachedWithImages = cached.missions.map((mission) => ({
          ...mission,
          // Do not persist expiring signed URLs.
          imageUrl: '/mission-default.jpg',
        }))

        if (!cancelled) {
          setMissions(cachedWithImages)
          setLoading(false)
        }

        // Refresh only the image signatures without blocking the UI.
        void attachImageUrls(cached.missions).then((withImages) => {
          if (!cancelled) setMissions(withImages)
        })
      }

      try {
        // 2) Refresh participant + mission data in the background.
        const { data: me, error: meError } = await supabase.rpc(
          'get_my_participant',
          { p_event_id: eventId },
        )

        if (meError) throw meError

        const participant = Array.isArray(me) ? me[0] : me

        if (!participant?.participant_id) {
          window.location.replace('/join')
          return
        }

        const { data: assignments, error: assignmentError } =
          await supabase
            .from('mission_assignments')
            .select(`
              id,
              first_cleared_at,
              mission:missions (
                id,
                title,
                difficulty,
                points,
                required_mentions,
                image_path,
                drop:mission_drops (
                  event_id,
                  status,
                  drop_number
                )
              )
            `)
            .eq('participant_id', participant.participant_id)
            .order('created_at', { ascending: true })

        if (assignmentError) throw assignmentError

        const freshBase =
          assignments
            ?.filter((assignment: any) => {
              const mission = assignment.mission
              const drop = mission?.drop

              return (
                mission &&
                drop &&
                drop.event_id === eventId &&
                drop.status === 'published'
              )
            })
            .map((assignment: any) => ({
              assignmentId: assignment.id,
              cleared: Boolean(assignment.first_cleared_at),
              id: assignment.mission.id,
              title: assignment.mission.title,
              difficulty: assignment.mission.difficulty,
              points: assignment.mission.points,
              dropNumber: assignment.mission.drop.drop_number,
              requiredMentions: assignment.mission.required_mentions,
              imagePath: assignment.mission.image_path,
            })) ?? []

        writeCache(eventId, user.id, {
          savedAt: Date.now(),
          participantId: participant.participant_id,
          missions: freshBase,
        })

        const freshWithImages = await attachImageUrls(freshBase)

        if (!cancelled) {
          setMissions(freshWithImages)
          setError('')
        }
      } catch (loadError) {
        console.error(loadError)

        // If cached data exists, keep showing it even if refresh fails.
        if (!cached && !cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Mission情報を読み込めませんでした',
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [eventId, supabase])

  const visibleMissions =
    activeFilter === 'clear'
      ? missions.filter((mission) => mission.cleared)
      : activeFilter === 'unclear'
        ? missions.filter((mission) => !mission.cleared)
        : missions

  if (!eventId) {
    return (
      <main className="participantUi">
        <div className="participantContent">
          <section className="glassCardStrong" style={{ padding: 20 }}>
            <p className="uiEyebrow">ERROR</p>
            <h1 className="uiTitle">イベント設定を読み込めません</h1>
            <p className="uiMuted">NEXT_PUBLIC_EVENT_ID が設定されていません。</p>
          </section>
        </div>
      </main>
    )
  }

  if (loading && missions.length === 0) {
    return (
      <main
        className="participantUi"
        style={
          {
            '--participant-bg-image': 'url("/outing-bg.jpg")',
          } as React.CSSProperties
        }
      >
        <div className="participantContent">
          <section className="glassCardStrong" style={{ padding: 20 }}>
            <p className="uiEyebrow">MISSIONS</p>
            <p className="uiMuted">読み込み中...</p>
          </section>
        </div>
      </main>
    )
  }

  if (error && missions.length === 0) {
    return (
      <main
        className="participantUi"
        style={
          {
            '--participant-bg-image': 'url("/outing-bg.jpg")',
          } as React.CSSProperties
        }
      >
        <div className="participantContent">
          <section className="glassCardStrong" style={{ padding: 20 }}>
            <p className="uiEyebrow">ERROR</p>
            <h2 style={{ margin: '6px 0 8px' }}>
              Mission情報を読み込めませんでした
            </h2>
            <p className="uiMuted">{error}</p>
          </section>
        </div>
      </main>
    )
  }

return (
    <main
      className="participantUi"
      style={
        {
          '--participant-bg-image':
            'url("/outing-bg.jpg")',
        } as React.CSSProperties
      }
    >
      <div className="participantContent">

        {/* =========================
            HEADER
        ========================= */}

        <header
          style={{
            paddingTop: 24,
            marginBottom: 22,
          }}
        >
          <p
            className="outingSerifEn"
            style={{
              margin: 0,
              color: '#fff',
              fontSize: 25,
              lineHeight: 1,
              letterSpacing: '.12em',
            }}
          >
            OUTING 2026
          </p>


                   <h1
            className="outingSerifEn"
            style={{
              margin: '28px 0 0',
              color: '#fff',
              fontSize: 30,
              fontWeight: 500,
              lineHeight: 1,
              letterSpacing: '.16em',
            }}
          >
            MISSIONS
          </h1>

                </header>

                   {/* =========================
            FILTER TABS
        ========================= */}

        {missions.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: 6,
              marginBottom: 16,
            }}
          >
            {[
              {
                key: 'all',
                label: 'ALL',
                href: '/missions',
              },
              {
                key: 'unclear',
                label: 'UNCLEAR',
                href: '/missions?filter=unclear',
              },
              {
                key: 'clear',
                label: 'CLEAR',
                href: '/missions?filter=clear',
              },
            ].map((tab) => {
              const active =
                activeFilter === tab.key

              return (
                <Link
                  key={tab.key}
                  href={tab.href}
                  className="outingSerifEn"
                  style={{
                    flex: 1,
                    padding: '9px 8px 8px',
                    textAlign: 'center',
                    borderRadius: 7,
                    textDecoration: 'none',

                    background: active
                      ? 'rgba(113,72,215,.82)'
                      : 'rgba(255,255,255,.08)',

                    border: active
                      ? '1px solid rgba(182,155,255,.35)'
                      : '1px solid rgba(255,255,255,.06)',

                    color: active
                      ? '#fff'
                      : 'rgba(255,255,255,.38)',

                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '.13em',

                    boxShadow: active
                      ? '0 8px 22px rgba(87,49,177,.22)'
                      : 'none',
                  }}
                >
                  {tab.label}
                </Link>
              )
            })}
          </div>
        )}



  {/* =========================
            EMPTY
        ========================= */}

        {visibleMissions.length === 0 && (
          <section
            className="glassCardStrong"
            style={{
              padding: '34px 20px',
              textAlign: 'center',
              marginTop: 18,
            }}
          >
            <Target
              size={25}
              strokeWidth={1.4}
              style={{
                opacity: 0.5,
              }}
            />

            <h2
              className="outingSerifJa"
              style={{
                margin: '14px 0 7px',
                fontSize: 18,
              }}
            >
              表示できるMissionはありません
            </h2>

            <p
              className="outingSans"
              style={{
                margin: 0,
                color:
                  'rgba(255,255,255,.55)',
                fontSize: 12,
              }}
            >
              新しいDropが公開されると、ここにMissionが表示されます。
            </p>
          </section>
        )}

        {/* =========================
            MISSION CARDS
        ========================= */}

        <section
          style={{
            display: 'grid',
            gap: 12,
            paddingBottom: 120,
          }}
        >
          {visibleMissions.map(
            (mission) => {

        const params =
  new URLSearchParams({
    title: mission.title,
    points: String(mission.points),
    missionId: mission.id,
    eventId,
    dropNumber: String(mission.dropNumber),
  })


              const cameraHref =
                `/camera?${params.toString()}`

              return (
                <Link
                  key={
                    mission.assignmentId
                  }
                  href={`/missions/${mission.id}`}
                  style={{
                    textDecoration: 'none',
                    color: 'inherit',
                    display: 'block',
                  }}
                >
                  <article
                    style={{
                      position: 'relative',
                      height: 156,
                      overflow: 'hidden',
                      borderRadius: 10,

                      border:
                        '1px solid rgba(255,255,255,.10)',

                      boxShadow:
                        '0 15px 35px rgba(0,0,0,.22)',

                      opacity:
                        mission.cleared
                          ? 0.76
                          : 1,
                    }}
                  >
                    {/* PHOTO */}

                  <div
  style={{
    position: 'absolute',
    inset: 0,
  }}
>
  <PersistentMissionImage
    missionId={mission.id}
    src={mission.imageUrl}
    alt=""
    style={{
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      display: 'block',
    }}
  />
</div>

                    {/* DARK GRADIENT */}

                    <div
                      style={{
                        position:
                          'absolute',
                        inset: 0,

                        background:
                          'linear-gradient(90deg, rgba(5,5,9,.88) 0%, rgba(5,5,9,.48) 55%, rgba(5,5,9,.12) 100%), linear-gradient(to top, rgba(0,0,0,.48), transparent 55%)',
                      }}
                    />

                    {/* CONTENT */}

                    <div
                      style={{
                        position:
                          'relative',
                        zIndex: 1,

                        height: '100%',
                        padding:
                          '15px 16px',

                        display: 'flex',
                        flexDirection:
                          'column',

                        justifyContent:
                          'space-between',
                      }}
                    >
                      {/* TOP */}

                      <div
                        style={{
                          display: 'flex',
                          alignItems:
                            'flex-start',
                          justifyContent:
                            'space-between',
                          gap: 12,
                        }}
                      >
                        <span
                          className="outingSerifEn"
                          style={{
                            color:
                              'rgba(255,255,255,.65)',
                            fontSize: 9,
                            fontWeight: 600,
                            letterSpacing:
                              '.16em',
                          }}
                        >
                          DROP{' '}
                          {String(
                            mission.dropNumber,
                          ).padStart(2, '0')}
                        </span>

                        <span
                          className="outingSerifEn"
                          style={{
                            color:
                              '#d9c8ff',
                            fontSize: 11,
                            fontWeight: 600,
                            letterSpacing:
                              '.08em',
                          }}
                        >
                          +{mission.points} PT
                        </span>
                      </div>

                      {/* BOTTOM */}

                      <div>
                        {mission.cleared && (
                          <div
                            style={{
                              display:
                                'inline-flex',
                              alignItems:
                                'center',
                              gap: 4,

                              marginBottom: 5,

                              color:
                                '#d8c8ff',

                              fontSize: 9,
                              fontWeight: 700,
                              letterSpacing:
                                '.10em',
                            }}
                          >
                            <Check
                              size={11}
                              strokeWidth={
                                2
                              }
                            />
                            CLEAR
                          </div>
                        )}

                        <h2
                          className="outingSerifJa"
                          style={{
                            margin: 0,
                            maxWidth: '78%',

                            color: '#fff',

                            fontSize: 19,
                            fontWeight: 400,
                            lineHeight: 1.45,

                            textShadow:
                              '0 2px 12px rgba(0,0,0,.5)',
                          }}
                        >
                          {mission.title}
                        </h2>

                        <div
                          style={{
                            display: 'flex',
                            alignItems:
                              'center',
                            gap: 7,
                            marginTop: 8,

                            color:
                              'rgba(255,255,255,.58)',

                            fontSize: 9,
                          }}
                        >
                          <Users
                            size={11}
                            strokeWidth={
                              1.6
                            }
                          />

                          <span
                            className="outingSans"
                          >
                            {mission.requiredMentions}人をメンション
                          </span>

                          {mission.difficulty && (
                            <>
                              <span>・</span>

                              <span
                                className="outingSans"
                              >
                                {
                                  mission.difficulty
                                }
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* ARROW */}

                    <div
                      style={{
                        position:
                          'absolute',
                        right: 13,
                        bottom: 13,
                        zIndex: 2,

                        width: 29,
                        height: 29,

                        display: 'grid',
                        placeItems: 'center',

                        borderRadius:
                          '50%',

                        background:
                          'rgba(9,8,15,.55)',

                        border:
                          '1px solid rgba(255,255,255,.22)',

                        backdropFilter:
                          'blur(8px)',
                      }}
                    >
                      <ArrowUpRight
                        size={14}
                        color="#fff"
                        strokeWidth={
                          1.5
                        }
                      />
                    </div>
                  </article>
                </Link>
              )
            },
          )}
        </section>
      </div>

      {/* =========================
          BOTTOM NAV
      ========================= */}

      <nav className="outingNav">
        <Link href="/">
          <HomeIcon />
          <span>Home</span>
        </Link>

        <Link href="/guide">
          <BookOpen />
          <span>Guide</span>
        </Link>

        <Link
          href="/missions"
          className="active"
        >
          <Target />
          <span>Mission</span>
        </Link>

        <Link href="/stream">
          <Images />
          <span>Stream</span>
        </Link>

        <Link href="/me">
          <UserRound />
          <span>My</span>
        </Link>
      </nav>
    </main>
  )
}
