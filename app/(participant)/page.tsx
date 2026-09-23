'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  HomeIcon,
  Images,
  Target,
  UserRound,
} from 'lucide-react'

import PointTop5 from '@/components/PointTop5'
import { createClient } from '@/lib/supabase/client'

type MissionRow = {
  id: string
  title: string
  difficulty: string
  points: number
  dropNumber: number
  cleared: boolean
  imagePath: string | null
}

type AnnouncementRow = {
  id: string
  title: string
  body: string
  published_at: string | null
  created_at: string
}

type HomeCache = {
  savedAt: number
  participantId: string
  announcements: AnnouncementRow[]
  missions: MissionRow[]
  announcementBackgroundPath: string
}

const HOME_CACHE_VERSION = 'outing-home-v4'
const UI_IMAGE_CACHE_NAME = 'outing-ui-images-v2'
const homeMemoryCache = new Map<string, HomeCache>()

async function getCachedHomeImage(
  stableId: string,
  signedUrl: string,
): Promise<string> {
  if (!('caches' in window)) return signedUrl

  const cache = await caches.open(UI_IMAGE_CACHE_NAME)
  const stableUrl =
    `${window.location.origin}/__outing-cache/ui/` +
    encodeURIComponent(stableId)
  const request = new Request(stableUrl)
  const cached = await cache.match(request)

  if (cached) {
    return URL.createObjectURL(await cached.blob())
  }

  const response = await fetch(signedUrl)
  if (!response.ok) return signedUrl

  await cache.put(request, response.clone())
  return URL.createObjectURL(await response.blob())
}

function getHomeCacheKey(eventId: string, userId: string) {
  return `${HOME_CACHE_VERSION}:${eventId}:${userId}`
}

function readHomeCache(eventId: string, userId: string): HomeCache | null {
  const key = getHomeCacheKey(eventId, userId)
  const memory = homeMemoryCache.get(key)
  if (memory) return memory

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null

    const parsed = JSON.parse(raw) as HomeCache
    if (
      !parsed ||
      !Array.isArray(parsed.announcements) ||
      !Array.isArray(parsed.missions)
    ) {
      return null
    }

    homeMemoryCache.set(key, parsed)
    return parsed
  } catch {
    return null
  }
}

function writeHomeCache(
  eventId: string,
  userId: string,
  value: HomeCache,
) {
  const key = getHomeCacheKey(eventId, userId)
  homeMemoryCache.set(key, value)

  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Cache failure must never block Home.
  }
}

export default function Home() {
  const supabase = useMemo(() => createClient(), [])
  const eventId = process.env.NEXT_PUBLIC_EVENT_ID ?? ''

  const [announcements, setAnnouncements] =
    useState<AnnouncementRow[]>([])
  const [normalizedMissions, setNormalizedMissions] =
    useState<MissionRow[]>([])
  const [announcementError, setAnnouncementError] =
    useState<Error | null>(null)
  const [missionError, setMissionError] =
    useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const [announcementBackgroundUrl, setAnnouncementBackgroundUrl] =
    useState('/outing-bg.jpg')
  const [missionImageUrl, setMissionImageUrl] =
    useState('/mission-default.jpg')

  useEffect(() => {
    if (!eventId) {
      setLoading(false)
      return
    }

    let cancelled = false
    let announcementObjectUrl: string | null = null

    async function applyAnnouncementBackground(path: string) {
      if (!path) {
        if (!cancelled) setAnnouncementBackgroundUrl('/outing-bg.jpg')
        return
      }

      const { data, error } = await supabase.storage
        .from('outing-photos')
        .createSignedUrl(path, 60 * 60)

      if (error || !data?.signedUrl || cancelled) return

      try {
        const url = await getCachedHomeImage(
          `announcement:${eventId}:${path}`,
          data.signedUrl,
        )

        if (cancelled) {
          if (url.startsWith('blob:')) URL.revokeObjectURL(url)
          return
        }

        if (announcementObjectUrl) {
          URL.revokeObjectURL(announcementObjectUrl)
        }

        announcementObjectUrl = url.startsWith('blob:') ? url : null
        setAnnouncementBackgroundUrl(url)
      } catch {
        if (!cancelled) setAnnouncementBackgroundUrl(data.signedUrl)
      }
    }

    async function loadHome() {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        window.location.replace('/join')
        return
      }

      const cached = readHomeCache(eventId, user.id)

      if (cached) {
        setAnnouncements(cached.announcements)
        setNormalizedMissions(cached.missions)
        setLoading(false)
        void applyAnnouncementBackground(
          cached.announcementBackgroundPath ?? '',
        )
      }

      try {
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

        // These reads are independent, so run them together.
        const [announcementResult, assignmentResult, eventResult] =
          await Promise.all([
            supabase
              .from('announcements')
              .select(`
                id,
                title,
                body,
                published_at,
                created_at
              `)
              .eq('event_id', eventId)
              .eq('is_published', true)
              .order('published_at', {
                ascending: false,
                nullsFirst: false,
              })
              .limit(3),

            supabase
              .from('mission_assignments')
              .select(`
                id,
                first_cleared_at,
                mission:missions (
                  id,
                  title,
                  difficulty,
                  points,
                  image_path,
                  drop:mission_drops (
                    event_id,
                    status,
                    drop_number
                  )
                )
              `)
              .eq('participant_id', participant.participant_id)
              .order('created_at', { ascending: false }),

            supabase
              .from('events')
              .select('announcement_background_path')
              .eq('id', eventId)
              .maybeSingle(),
          ])

        if (announcementResult.error) {
          setAnnouncementError(
            new Error(announcementResult.error.message),
          )
        } else {
          setAnnouncementError(null)
        }

        if (assignmentResult.error) {
          setMissionError(new Error(assignmentResult.error.message))
        } else {
          setMissionError(null)
        }

        const freshAnnouncements =
          (announcementResult.data ?? []) as AnnouncementRow[]

        const freshMissions: MissionRow[] =
          (assignmentResult.data ?? [])
            .map((assignment: any): MissionRow | null => {
              const mission = Array.isArray(assignment.mission)
                ? assignment.mission[0]
                : assignment.mission

              if (!mission) return null

              const drop = Array.isArray(mission.drop)
                ? mission.drop[0]
                : mission.drop

              if (
                !drop ||
                drop.event_id !== eventId ||
                drop.status !== 'published'
              ) {
                return null
              }

              return {
                id: mission.id,
                title: mission.title,
                difficulty: mission.difficulty,
                points: mission.points,
                dropNumber: drop.drop_number,
                cleared: Boolean(assignment.first_cleared_at),
                imagePath: mission.image_path ?? null,
              }
            })
            .filter(
              (mission: MissionRow | null): mission is MissionRow =>
                mission !== null,
            )

        freshMissions.sort(
          (a, b) => a.dropNumber - b.dropNumber,
        )

        const nextAnnouncements = announcementResult.error
          ? cached?.announcements ?? []
          : freshAnnouncements

        const nextMissions = assignmentResult.error
          ? cached?.missions ?? []
          : freshMissions

        if (!cancelled) {
          setAnnouncements(nextAnnouncements)
          setNormalizedMissions(nextMissions)
        }

        const announcementBackgroundPath =
          eventResult.data?.announcement_background_path ??
          cached?.announcementBackgroundPath ??
          ''

        writeHomeCache(eventId, user.id, {
          savedAt: Date.now(),
          participantId: participant.participant_id,
          announcements: nextAnnouncements,
          missions: nextMissions,
          announcementBackgroundPath,
        })

        void applyAnnouncementBackground(announcementBackgroundPath)
      } catch (error) {
        console.error(error)

        if (!cached && !cancelled) {
          const normalized =
            error instanceof Error
              ? error
              : new Error('Homeを読み込めませんでした')
          setAnnouncementError(normalized)
          setMissionError(normalized)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadHome()

    return () => {
      cancelled = true
      if (announcementObjectUrl) {
        URL.revokeObjectURL(announcementObjectUrl)
      }
    }
  }, [eventId, supabase])

  const currentMission =
    normalizedMissions.find((mission) => !mission.cleared) ?? null

  useEffect(() => {
    let cancelled = false
    let missionObjectUrl: string | null = null

    async function applyMissionImage() {
      const imagePath = currentMission?.imagePath

      if (!imagePath) {
        setMissionImageUrl('/mission-default.jpg')
        return
      }

      const { data, error } = await supabase.storage
        .from('outing-photos')
        .createSignedUrl(imagePath, 60 * 60)

      if (error || !data?.signedUrl || cancelled) {
        if (!cancelled) setMissionImageUrl('/mission-default.jpg')
        return
      }

      try {
        const url = await getCachedHomeImage(
          `mission:${currentMission.id}:${imagePath}`,
          data.signedUrl,
        )

        if (cancelled) {
          if (url.startsWith('blob:')) URL.revokeObjectURL(url)
          return
        }

        missionObjectUrl = url.startsWith('blob:') ? url : null
        setMissionImageUrl(url)
      } catch {
        if (!cancelled) setMissionImageUrl(data.signedUrl)
      }
    }

    void applyMissionImage()

    return () => {
      cancelled = true
      if (missionObjectUrl) URL.revokeObjectURL(missionObjectUrl)
    }
  }, [currentMission?.id, currentMission?.imagePath, supabase])

  if (!eventId) {
    return (
      <main className="participantUi">
        <div className="participantContent">
          <section className="glassCard" style={{ padding: 18 }}>
            <h2 className="outingSerifJa">設定エラー</h2>
            <p className="uiMuted outingSans">
              NEXT_PUBLIC_EVENT_ID が設定されていません。
            </p>
          </section>
        </div>
      </main>
    )
  }

  if (loading && announcements.length === 0 && !currentMission) {
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
          <section className="glassCard" style={{ padding: 18 }}>
            <p className="uiMuted outingSans">読み込み中...</p>
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
            marginBottom: 24,
          }}
        >
          <h1
            className="outingSerifEn"
            style={{
              margin: 0,
              color: '#fff',
              fontSize: 25,
              fontWeight: 500,
              lineHeight: 1,
              letterSpacing: '.12em',
            }}
          >
            OUTING 2026
          </h1>
        </header>

        {/* =========================
            ANNOUNCEMENT
        ========================= */}

        {!announcementError &&
          announcements &&
          announcements.length > 0 && (
            <section
              style={{
                position: 'relative',
                overflow: 'hidden',
                borderRadius: 22,
                marginBottom: 24,
                minHeight: 180,

                backgroundImage:
                  `linear-gradient(135deg, rgba(8,10,16,.82), rgba(18,11,30,.68)), url("${announcementBackgroundUrl}")`,

                backgroundSize: 'cover',
                backgroundPosition: 'center',

                border:
                  '1px solid rgba(255,255,255,.10)',

                boxShadow:
                  '0 18px 45px rgba(0,0,0,.24)',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,

                  background:
                    'linear-gradient(to bottom, rgba(0,0,0,.06), rgba(0,0,0,.30))',

                  pointerEvents: 'none',
                }}
              />

              <div
                style={{
                  position: 'relative',
                  zIndex: 1,

                  padding: 17,

                  backdropFilter:
                    'blur(2px)',

                  WebkitBackdropFilter:
                    'blur(2px)',
                }}
              >
                <p
                  className="outingSerifEn"
                  style={{
                    margin: 0,

                    color:
                      'rgba(255,255,255,.72)',

                    fontSize: 13,
                    fontWeight: 500,
                    letterSpacing: '.16em',
                  }}
                >
                  ANNOUNCEMENT
                </p>

                <div
                  style={{
                    display: 'grid',
                    gap: 12,
                    marginTop: 14,
                  }}
                >
                  {announcements.map(
                    (announcement) => (
                      <article
                        key={
                          announcement.id
                        }
                        style={{
                          padding:
                            '13px 14px',

                          borderRadius: 16,

                          background:
                            'rgba(10,11,17,.46)',

                          border:
                            '1px solid rgba(255,255,255,.08)',

                          backdropFilter:
                            'blur(14px)',

                          WebkitBackdropFilter:
                            'blur(14px)',

                          boxShadow:
                            '0 8px 24px rgba(0,0,0,.12)',
                        }}
                      >
                        <h2
                          className="outingSerifJa"
                          style={{
                            margin: 0,

                            fontSize: 16,
                            fontWeight: 400,
                            lineHeight: 1.5,

                            color: '#fff',

                            textShadow:
                              '0 1px 8px rgba(0,0,0,.35)',
                          }}
                        >
                          {
                            announcement.title
                          }
                        </h2>

                        <p
                          className="outingSans"
                          style={{
                            margin:
                              '7px 0 0',

                            whiteSpace:
                              'pre-wrap',

                            lineHeight: 1.65,
                            fontSize: 13,

                            color:
                              'rgba(255,255,255,.72)',
                          }}
                        >
                          {
                            announcement.body
                          }
                        </p>

                        <small
                          className="outingSans"
                          style={{
                            display: 'block',

                            marginTop: 9,

                            fontSize: 10,

                            color:
                              'rgba(255,255,255,.42)',
                          }}
                        >
                          {new Date(
                            announcement.published_at ??
                              announcement.created_at,
                          ).toLocaleString(
                            'ja-JP',
                            {
                              month:
                                'numeric',
                              day: 'numeric',
                              hour: '2-digit',
                              minute:
                                '2-digit',
                            },
                          )}
                        </small>
                      </article>
                    ),
                  )}
                </div>
              </div>
            </section>
          )}

        {/* =========================
            TODAY'S MISSION
        ========================= */}

        <section
          style={{
            marginBottom: 24,
          }}
        >
          <p
            className="outingSerifEn"
            style={{
              margin:
                '0 0 10px',

              color:
                'rgba(255,255,255,.72)',

              fontSize: 13,
              fontWeight: 500,
              letterSpacing: '.16em',
            }}
          >
            TODAY&apos;S MISSION
          </p>

          {missionError ? (
            <div
              className="glassCard"
              style={{
                padding: 18,
              }}
            >
              <h2
                className="outingSerifJa"
                style={{
                  margin: 0,
                  fontSize: 16,
                }}
              >
                Missionを読み込めませんでした
              </h2>

              <p className="uiMuted outingSans">
                {missionError.message}
              </p>
            </div>
          ) : currentMission ? (
            <article className="photoCard">
              <img
                src={missionImageUrl}
                alt=""
                className="photoCardImage"
              />

              <div className="photoCardContent">

                <div
                  style={{
                    display: 'flex',

                    alignItems: 'center',

                    justifyContent:
                      'space-between',

                    gap: 12,

                    marginBottom: 10,
                  }}
                >
                  <span
                    className="outingSerifEn"
                    style={{
                      fontSize: 11,

                      fontWeight: 600,

                      letterSpacing:
                        '.12em',
                    }}
                  >
                    DROP{' '}
                    {String(
                      currentMission.dropNumber,
                    ).padStart(
                      2,
                      '0',
                    )}
                  </span>

                  <span
                    className="outingSerifEn"
                    style={{
                      fontSize: 12,

                      fontWeight: 600,

                      letterSpacing:
                        '.08em',

                      color:
                        '#d8c9ff',
                    }}
                  >
                    +
                    {
                      currentMission.points
                    }{' '}
                    PT
                  </span>
                </div>

                <h2
                  className="outingSerifJa"
                  style={{
                    margin: 0,

                    color: '#fff',

                    fontSize: 21,
                    fontWeight: 400,
                    letterSpacing: '.015em',

                    lineHeight: 1.45,
                  }}
                >
                  {
                    currentMission.title
                  }
                </h2>

                <div
                  className="outingSans"
                  style={{
                    display: 'flex',

                    alignItems:
                      'center',

                    gap: 8,

                    marginTop: 10,

                    color:
                      'rgba(255,255,255,.72)',

                    fontSize: 12,
                  }}
                >
                  <span>
                    {
                      currentMission.difficulty
                    }
                  </span>

                  {currentMission.cleared && (
                    <>
                      <span>・</span>

                      <span
                        style={{
                          display:
                            'inline-flex',

                          alignItems:
                            'center',

                          gap: 5,

                          color:
                            '#d8c9ff',

                          fontWeight: 700,
                        }}
                      >
                        <CheckCircle2
                          size={14}
                        />
                        CLEAR
                      </span>
                    </>
                  )}
                </div>

                <Link
                  href="/missions"
                  className="outingSans"
                  style={{
                    marginTop: 17,
                    alignSelf: 'flex-start',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    minHeight: 38,
                    padding: '0 15px',
                    borderRadius: 999,
                    border: '1px solid rgba(255,255,255,.16)',
                    background: 'rgba(8,9,13,.52)',
                    color: 'rgba(255,255,255,.88)',
                    boxShadow:
                      '0 8px 22px rgba(0,0,0,.16), inset 0 1px 0 rgba(255,255,255,.04)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    textDecoration: 'none',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '.025em',
                  }}
                >
                  Missionを見る
                  <ArrowRight size={14} strokeWidth={1.7} />
                </Link>
              </div>
            </article>
          ) : (
            <div
              className="glassCard"
              style={{
                padding: 18,
              }}
            >
              <h2
                className="outingSerifJa"
                style={{
                  margin: 0,

                  fontSize: 17,
                  fontWeight: 400,
                }}
              >
                現在公開中のMissionはありません
              </h2>

              <p
                className="uiMuted outingSans"
                style={{
                  marginBottom: 0,
                }}
              >
                新しいDropが公開されるとここに表示されます。
              </p>
            </div>
          )}
        </section>

        {/* =========================
            TOP PLAYERS
        ========================= */}

        <section
          style={{
            marginBottom: 24,
          }}
        >
          <p
            className="outingSerifEn"
            style={{
              margin:
                '0 0 10px',

              color:
                'rgba(255,255,255,.72)',

              fontSize: 13,
              fontWeight: 500,
              letterSpacing: '.16em',
            }}
          >
            TOP PLAYERS
          </p>

          <div className="glassCardStrong">
            <PointTop5 />
          </div>
        </section>
      </div>

      {/* =========================
          BOTTOM NAV
      ========================= */}

      <nav className="outingNav">
        <Link
          className="active"
          href="/"
        >
          <HomeIcon />
          <span>Home</span>
        </Link>

        <Link href="/guide">
          <BookOpen />
          <span>Guide</span>
        </Link>

        <Link href="/missions">
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