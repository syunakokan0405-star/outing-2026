import Link from 'next/link'
import { redirect } from 'next/navigation'
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
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type MissionRow = {
  id: string
  title: string
  difficulty: string
  points: number
  dropNumber: number
  cleared: boolean
}

export default async function Home() {
  const supabase = await createClient()
  const eventId = process.env.NEXT_PUBLIC_EVENT_ID

  if (!eventId) {
    return (
      <main className="participantUi">
        <div className="participantContent">
          <section
            className="glassCard"
            style={{ padding: 18 }}
          >
            <h2 className="outingSerifJa">
              設定エラー
            </h2>

            <p className="uiMuted outingSans">
              NEXT_PUBLIC_EVENT_ID が設定されていません。
            </p>
          </section>
        </div>
      </main>
    )
  }

  const { data: me, error: meError } =
    await supabase.rpc(
      'get_my_participant',
      {
        p_event_id: eventId,
      },
    )

  if (meError) {
    return (
      <main className="participantUi">
        <div className="participantContent">
          <section
            className="glassCard"
            style={{ padding: 18 }}
          >
            <h2 className="outingSerifJa">
              参加者情報を取得できませんでした
            </h2>

            <p className="uiMuted outingSans">
              {meError.message}
            </p>
          </section>
        </div>
      </main>
    )
  }

  const participant =
    Array.isArray(me) ? me[0] : me

  if (!participant?.participant_id) {
    redirect('/join')
  }

  const {
    data: announcements,
    error: announcementError,
  } = await supabase
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
    .limit(3)

  const {
    data: assignments,
    error: missionError,
  } = await supabase
    .from('mission_assignments')
    .select(`
      id,
      first_cleared_at,
      mission:missions (
        id,
        title,
        difficulty,
        points,
        drop:mission_drops (
          event_id,
          status,
          drop_number
        )
      )
    `)
    .eq(
      'participant_id',
      participant.participant_id,
    )
    .order('created_at', {
      ascending: false,
    })

  const normalizedMissions: MissionRow[] =
    assignments
      ?.map(
        (
          assignment: any,
        ): MissionRow | null => {
          const mission = Array.isArray(
            assignment.mission,
          )
            ? assignment.mission[0]
            : assignment.mission

          if (!mission) {
            return null
          }

          const drop = Array.isArray(
            mission.drop,
          )
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
            cleared: Boolean(
              assignment.first_cleared_at,
            ),
          }
        },
      )
      .filter(
        (
          mission,
        ): mission is MissionRow =>
          mission !== null,
      ) ?? []

  normalizedMissions.sort(
    (a, b) =>
      b.dropNumber - a.dropNumber,
  )

  const currentMission =
    normalizedMissions[0] ?? null

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
                  'linear-gradient(135deg, rgba(8,10,16,.82), rgba(18,11,30,.68)), url("/outing-bg.jpg")',

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
                src="/mission-default.jpg"
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

                    fontSize: 24,
                    fontWeight: 400,

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
                  className="uiPrimaryButton outingSans"
                  style={{
                    marginTop: 18,
                    alignSelf:
                      'flex-start',
                  }}
                >
                  Missionを見る
                  <ArrowRight
                    size={17}
                  />
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