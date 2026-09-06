import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  BookOpen,
  Camera,
  CheckCircle2,
  HomeIcon,
  Images,
  Target,
  UserRound,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'

export default async function Missions() {
  const supabase = await createClient()
  const eventId = process.env.NEXT_PUBLIC_EVENT_ID

  if (!eventId) {
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
          <section
            className="glassCardStrong"
            style={{ padding: 20 }}
          >
            <p className="uiEyebrow">ERROR</p>
            <h1 className="uiTitle">
              設定エラー
            </h1>
            <p className="uiMuted">
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
          <section
            className="glassCardStrong"
            style={{ padding: 20 }}
          >
            <p className="uiEyebrow">ERROR</p>
            <h2
              style={{
                margin: '6px 0 8px',
              }}
            >
              参加者情報を取得できませんでした
            </h2>

            <p className="uiMuted">
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
    data: assignments,
    error: assignmentError,
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
        required_mentions,
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

  if (assignmentError) {
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
          <section
            className="glassCardStrong"
            style={{ padding: 20 }}
          >
            <p className="uiEyebrow">ERROR</p>

            <h2
              style={{
                margin: '6px 0 8px',
              }}
            >
              Missionを取得できませんでした
            </h2>

            <p className="uiMuted">
              {assignmentError.message}
            </p>
          </section>
        </div>
      </main>
    )
  }

  const missions =
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
        cleared: Boolean(
          assignment.first_cleared_at,
        ),
        id: assignment.mission.id,
        title: assignment.mission.title,
        difficulty:
          assignment.mission.difficulty,
        points: assignment.mission.points,
        dropNumber:
          assignment.mission.drop.drop_number,
      })) ?? []

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
            paddingTop: 18,
            marginBottom: 28,
          }}
        >
          <p className="uiEyebrow">
            OUTING 2026
          </p>

          <h1
            className="uiTitle"
            style={{
              marginTop: 6,
            }}
          >
            Mission
          </h1>

          <p
            className="uiMuted"
            style={{
              marginTop: 8,
            }}
          >
            あなたに割り当てられたPhoto Mission
          </p>
        </header>

        {missions.length === 0 && (
          <section
            className="glassCardStrong"
            style={{
              padding: '30px 20px',
              textAlign: 'center',
            }}
          >
            <Target
              size={26}
              strokeWidth={1.5}
              style={{
                opacity: 0.55,
              }}
            />

            <h2
              style={{
                margin: '14px 0 6px',
                fontSize: 18,
              }}
            >
              現在Missionはありません
            </h2>

            <p
              className="uiMuted"
              style={{
                margin: 0,
              }}
            >
              新しいDropが公開されると
              ここに表示されます。
            </p>
          </section>
        )}

        <section
          style={{
            display: 'grid',
            gap: 18,
            paddingBottom: 120,
          }}
        >
          {missions.map((mission) => {
            const params =
              new URLSearchParams({
                title: mission.title,
                points: String(
                  mission.points,
                ),
                missionId: mission.id,
                eventId,
              })

            const cameraHref =
              `/camera?${params.toString()}`

            return (
              <article
                key={mission.assignmentId}
                className="photoCard"
                style={{
                  minHeight: 360,
                  opacity:
                    mission.cleared
                      ? 0.72
                      : 1,
                }}
              >
                <img
                  src="/mission-default.jpg"
                  alt=""
                  className="photoCardImage"
                />

                <div
                  className="photoCardContent"
                  style={{
                    minHeight: 360,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent:
                      'space-between',
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent:
                          'space-between',
                        gap: 12,
                      }}
                    >
                      <span
                        className="uiEyebrow"
                        style={{
                          color: '#fff',
                        }}
                      >
                        DROP{' '}
                        {mission.dropNumber}
                      </span>

                      <strong
                        style={{
                          fontSize: 13,
                          color:
                            '#d8c9ff',
                        }}
                      >
                        +{mission.points} PT
                      </strong>
                    </div>
                  </div>

                  <div>
                    {mission.cleared && (
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems:
                            'center',
                          gap: 6,
                          marginBottom: 10,
                          padding:
                            '6px 9px',
                          borderRadius: 999,
                          background:
                            'rgba(139,92,246,.20)',
                          border:
                            '1px solid rgba(167,139,250,.25)',
                          fontSize: 11,
                          fontWeight: 750,
                        }}
                      >
                        <CheckCircle2
                          size={14}
                        />
                        CLEAR
                      </div>
                    )}

                    <h2
                      style={{
                        margin: 0,
                        color: '#fff',
                        fontSize: 28,
                        lineHeight: 1.25,
                        letterSpacing:
                          '-.03em',
                      }}
                    >
                      {mission.title}
                    </h2>

                    <div
                      style={{
                        display: 'flex',
                        gap: 10,
                        flexWrap: 'wrap',
                        marginTop: 12,
                        color:
                          'rgba(255,255,255,.64)',
                        fontSize: 12,
                      }}
                    >
                      <span>
                        {mission.difficulty}
                      </span>

                      <span>・</span>

                      <span>
                        メンション任意
                      </span>
                    </div>

                    {mission.cleared && (
                      <p
                        style={{
                          margin:
                            '10px 0 0',
                          color:
                            'rgba(255,255,255,.56)',
                          fontSize: 12,
                        }}
                      >
                        再撮影OK・追加ポイントはありません。
                      </p>
                    )}

                    <Link
                      href={cameraHref}
                      className="uiPrimaryButton"
                      style={{
                        marginTop: 20,
                        width: '100%',
                        justifyContent:
                          'center',
                        textDecoration:
                          'none',
                        display:
                          'inline-flex',
                        alignItems:
                          'center',
                        gap: 8,
                      }}
                    >
                      <Camera
                        size={18}
                        strokeWidth={1.8}
                      />
                      {mission.cleared
                        ? 'もう一度撮る'
                        : 'カメラを開く'}
                    </Link>
                  </div>
                </div>
              </article>
            )
          })}
        </section>
      </div>

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