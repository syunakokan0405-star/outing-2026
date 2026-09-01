import Link from 'next/link'
import { redirect } from 'next/navigation'
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
      <main className="shell grid">
        <section className="card">
          <h2>設定エラー</h2>
          <p>NEXT_PUBLIC_EVENT_ID が設定されていません。</p>
        </section>
      </main>
    )
  }

  // ---------------------------------------------------------
  // 現在ログイン中の参加者
  // ---------------------------------------------------------

  const { data: me, error: meError } = await supabase.rpc(
    'get_my_participant',
    {
      p_event_id: eventId,
    },
  )

  if (meError) {
    return (
      <main className="shell grid">
        <section className="card">
          <h2>参加者情報を取得できませんでした</h2>
          <p>{meError.message}</p>
        </section>
      </main>
    )
  }

  const participant = Array.isArray(me) ? me[0] : me

  if (!participant?.participant_id) {
    redirect('/join')
  }

  // ---------------------------------------------------------
  // 公開中のお知らせ
  // ---------------------------------------------------------

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

  // ---------------------------------------------------------
  // 自分に割り当てられたMission
  // ---------------------------------------------------------

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
      .eq(
        'participant_id',
        participant.participant_id,
      )
      .order('created_at', {
        ascending: false,
      })

  // Supabaseがrelationを配列として返す場合にも対応
  const normalizedMissions: MissionRow[] =
    assignments
      ?.map((assignment: any): MissionRow | null => {
        const mission = Array.isArray(
          assignment.mission,
        )
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
          cleared: Boolean(
            assignment.first_cleared_at,
          ),
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

  // ---------------------------------------------------------
  // HOME
  // ---------------------------------------------------------

  return (
    <main className="shell grid">
      <div>
        <div className="brand">OUTING 2026</div>
        <h1>Home</h1>
      </div>

      {/* 運営からのお知らせ */}

      {!announcementError &&
        announcements &&
        announcements.length > 0 && (
          <section
            className="card"
            style={{
              border:
                '1px solid rgba(139,92,246,0.35)',
            }}
          >
            <div
              className="muted"
              style={{
                marginBottom: 12,
              }}
            >
              📢 運営からのお知らせ
            </div>

            <div
              style={{
                display: 'grid',
                gap: 16,
              }}
            >
              {announcements.map(
                (announcement, index) => (
                  <div
                    key={announcement.id}
                    style={{
                      paddingBottom:
                        index <
                        announcements.length - 1
                          ? 16
                          : 0,

                      borderBottom:
                        index <
                        announcements.length - 1
                          ? '1px solid rgba(255,255,255,0.08)'
                          : 'none',
                    }}
                  >
                    <h2
                      style={{
                        marginBottom: 6,
                      }}
                    >
                      {announcement.title}
                    </h2>

                    <p
                      style={{
                        whiteSpace: 'pre-wrap',
                        lineHeight: 1.7,
                      }}
                    >
                      {announcement.body}
                    </p>

                    <small className="muted">
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
                  </div>
                ),
              )}
            </div>
          </section>
        )}

      {/* お知らせ取得エラー */}

      {announcementError && (
        <section className="card">
          <p className="muted">
            お知らせを読み込めませんでした。
          </p>
        </section>
      )}

      {/* Mission */}

      <section className="card">
        <div className="muted">
          CURRENT MISSION
        </div>

        {missionError ? (
          <>
            <h2>
              Missionを読み込めませんでした
            </h2>

            <p className="muted">
              {missionError.message}
            </p>
          </>
        ) : currentMission ? (
          <>
            <p className="muted">
              Drop #{currentMission.dropNumber}
              {' ・ '}
              {currentMission.difficulty}
              {' ・ '}
              +{currentMission.points}pt
            </p>

            <h2>{currentMission.title}</h2>

            {currentMission.cleared ? (
              <p>
                <b>CLEAR ✓</b>
              </p>
            ) : (
              <p className="muted">
                まだCLEARしていません。
              </p>
            )}

            <Link
              className="btn primary linkButton"
              href="/missions"
            >
              Missionを見る
            </Link>
          </>
        ) : (
          <>
            <h2>
              現在Missionはありません
            </h2>

            <p className="muted">
              新しいDropが公開されると
              ここに表示されます。
            </p>

            <Link
              className="btn primary linkButton"
              href="/missions"
            >
              Missionを見る
            </Link>
          </>
        )}
      </section>

      {/* Stream */}

      <section className="card">
        <div className="muted">
          STREAM
        </div>

        <h2>最新情報をチェック</h2>

        <p className="muted">
          参加者の写真や運営からの投稿を確認できます。
        </p>

        <Link
          className="btn linkButton"
          href="/stream"
        >
          Streamを見る
        </Link>
      </section>

      {/* Ranking */}

      <PointTop5 />

      {/* Bottom Navigation */}

      <nav className="nav">
        <Link
          className="active"
          href="/"
        >
          HOME
        </Link>

        <Link href="/guide">
          GUIDE
        </Link>

        <Link href="/missions">
          MISSION
        </Link>

        <Link href="/stream">
          STREAM
        </Link>

        <Link href="/me">
          MY
        </Link>
      </nav>
    </main>
  )
}