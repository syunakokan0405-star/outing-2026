import Link from 'next/link'
import { redirect } from 'next/navigation'
import {

  BookOpen,
  HomeIcon,
  Images,
  Target,
  UserRound,
  ArrowRight,
  CheckCircle2,
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
          <section className="glassCard" style={{ padding: 18 }}>
            <h2>設定エラー</h2>
            <p className="uiMuted">
              NEXT_PUBLIC_EVENT_ID が設定されていません。
            </p>
          </section>
        </div>
      </main>
    )
  }

  const { data: me, error: meError } = await supabase.rpc(
    'get_my_participant',
    {
      p_event_id: eventId,
    },
  )

  if (meError) {
    return (
      <main className="participantUi">
        <div className="participantContent">
          <section className="glassCard" style={{ padding: 18 }}>
            <h2>参加者情報を取得できませんでした</h2>
            <p className="uiMuted">{meError.message}</p>
          </section>
        </div>
      </main>
    )
  }

  const participant = Array.isArray(me) ? me[0] : me

  if (!participant?.participant_id) {
    redirect('/join')
  }

  const { data: announcements, error: announcementError } =
    await supabase
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

  const { data: assignments, error: missionError } =
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
          drop:mission_drops (
            event_id,
            status,
            drop_number
          )
        )
      `)
      .eq('participant_id', participant.participant_id)
      .order('created_at', {
        ascending: false,
      })

  const normalizedMissions: MissionRow[] =
    assignments
      ?.map((assignment: any): MissionRow | null => {
        const mission = Array.isArray(assignment.mission)
          ? assignment.mission[0]
          : assignment.mission

        if (!mission) {
          return null
        }

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
        }
      })
      .filter(
        (mission): mission is MissionRow =>
          mission !== null,
      ) ?? []

  normalizedMissions.sort(
    (a, b) => b.dropNumber - a.dropNumber,
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
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            marginBottom: 24,
          }}
        >
          <div>
            <p className="uiEyebrow">
              NIC STUDY TOUR
            </p>

            <h1
              className="uiTitle"
              style={{
                marginTop: 7,
              }}
            >
              OUTING 2026
            </h1>
          </div>

 
        </header>

        {!announcementError &&
          announcements &&
          announcements.length > 0 && (
            <section
              className="glassCard"
              style={{
                padding: 17,
                marginBottom: 24,
              }}
            >
              <p className="uiSectionTitle">
                ANNOUNCEMENT
              </p>

              <div
                style={{
                  display: 'grid',
                  gap: 15,
                  marginTop: 14,
                }}
              >
                {announcements.map(
                  (announcement, index) => (
                    <article
                      key={announcement.id}
                      style={{
                        paddingBottom:
                          index <
                          announcements.length - 1
                            ? 15
                            : 0,
                        borderBottom:
                          index <
                          announcements.length - 1
                            ? '1px solid rgba(255,255,255,.08)'
                            : 'none',
                      }}
                    >
                      <h2
                        style={{
                          margin: 0,
                          fontSize: 16,
                          lineHeight: 1.4,
                        }}
                      >
                        {announcement.title}
                      </h2>

                      <p
                        className="uiMuted"
                        style={{
                          margin: '7px 0 0',
                          whiteSpace: 'pre-wrap',
                          lineHeight: 1.6,
                          fontSize: 13,
                        }}
                      >
                        {announcement.body}
                      </p>

                      <small
                        className="uiMuted"
                        style={{
                          display: 'block',
                          marginTop: 9,
                          fontSize: 10,
                        }}
                      >
                        {new Date(
                          announcement.published_at ??
                            announcement.created_at,
                        ).toLocaleString('ja-JP', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </small>
                    </article>
                  ),
                )}
              </div>
            </section>
          )}

        <section style={{ marginBottom: 24 }}>
          <p
            className="uiSectionTitle"
            style={{ marginBottom: 10 }}
          >
            TODAY&apos;S MISSION
          </p>

          {missionError ? (
            <div
              className="glassCard"
              style={{ padding: 18 }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: 16,
                }}
              >
                Missionを読み込めませんでした
              </h2>

              <p className="uiMuted">
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
                    justifyContent: 'space-between',
                    gap: 12,
                    marginBottom: 10,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 750,
                      letterSpacing: '.08em',
                    }}
                  >
                    DROP {currentMission.dropNumber}
                  </span>

                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      color: '#d8c9ff',
                    }}
                  >
                    +{currentMission.points} PT
                  </span>
                </div>

                <h2
                  style={{
                    margin: 0,
                    fontSize: 24,
                    lineHeight: 1.3,
                    letterSpacing: '-.025em',
                  }}
                >
                  {currentMission.title}
                </h2>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginTop: 10,
                    color: 'rgba(255,255,255,.72)',
                    fontSize: 12,
                  }}
                >
                  <span>
                    {currentMission.difficulty}
                  </span>

                  {currentMission.cleared && (
                    <>
                      <span>・</span>

                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          color: '#8ee6b5',
                          fontWeight: 750,
                        }}
                      >
                        <CheckCircle2 size={14} />
                        CLEAR
                      </span>
                    </>
                  )}
                </div>

                <Link
                  href="/missions"
                  className="uiPrimaryButton"
                  style={{
                    marginTop: 18,
                    alignSelf: 'flex-start',
                  }}
                >
                  Missionを見る
                  <ArrowRight size={17} />
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
                style={{
                  margin: 0,
                  fontSize: 17,
                }}
              >
                現在公開中のMissionはありません
              </h2>

              <p
                className="uiMuted"
                style={{
                  marginBottom: 0,
                }}
              >
                新しいDropが公開されるとここに表示されます。
              </p>
            </div>
          )}
        </section>

        <section style={{ marginBottom: 24 }}>
          <p
            className="uiSectionTitle"
            style={{ marginBottom: 10 }}
          >
            TOP PLAYERS
          </p>

          <div className="glassCardStrong">
            <PointTop5 />
          </div>
        </section>
      </div>

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