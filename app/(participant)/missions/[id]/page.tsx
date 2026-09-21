import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  ArrowLeft,
  BookOpen,
  Camera,
  CheckCircle2,
  HomeIcon,
  Images,
  Lightbulb,
  Target,
  UserRound,
  Users,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import PersistentMissionImage from '@/components/PersistentMissionImage'

type PageProps = {
  params: Promise<{
    id: string
  }>
}

export default async function MissionDetail({
  params,
}: PageProps) {
  const { id: missionId } = await params

  const supabase = await createClient()
  const eventId =
    process.env.NEXT_PUBLIC_EVENT_ID

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
            <p className="uiEyebrow">
              ERROR
            </p>
            <h1>設定エラー</h1>
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
            <p className="uiEyebrow">
              ERROR
            </p>

            <h2>
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
    data: assignment,
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
        image_path,
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
    .eq(
      'mission_id',
      missionId,
    )
    .maybeSingle()

  if (
    assignmentError ||
    !assignment
  ) {
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
            style={{
              padding: 22,
              marginTop: 30,
            }}
          >
            <p className="uiEyebrow">
              MISSION
            </p>

            <h2
              className="outingSerifJa"
              style={{
                margin:
                  '8px 0 10px',
              }}
            >
              Missionが見つかりません
            </h2>

            <Link
              href="/missions"
              className="uiPrimaryButton"
              style={{
                display:
                  'inline-flex',
                marginTop: 10,
                textDecoration:
                  'none',
              }}
            >
              Mission一覧へ
            </Link>
          </section>
        </div>
      </main>
    )
  }

  const mission: any =
    Array.isArray(
      assignment.mission,
    )
      ? assignment.mission[0]
      : assignment.mission

  const drop: any =
    Array.isArray(mission?.drop)
      ? mission.drop[0]
      : mission?.drop

  if (
    !mission ||
    !drop ||
    drop.event_id !== eventId ||
    drop.status !== 'published'
  ) {
    redirect('/missions')
  }

  let missionImageUrl = '/mission-default.jpg'

  if (mission.image_path) {
    const { data: signedImage } = await supabase.storage
      .from('outing-photos')
      .createSignedUrl(mission.image_path, 60 * 60)

    if (signedImage?.signedUrl) {
      missionImageUrl = signedImage.signedUrl
    }
  }

  const cleared = Boolean(
    assignment.first_cleared_at,
  )

  const dropNumber =
    String(
      drop.drop_number,
    ).padStart(2, '0')

  const cameraParams =
    new URLSearchParams({
      title: mission.title,
      points: String(
        mission.points,
      ),
      missionId: mission.id,
      eventId,
      dropNumber: String(
        drop.drop_number,
      ),
    })

  const cameraHref =
    `/camera?${cameraParams.toString()}`

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
      <div
        className="participantContent"
        style={{
          paddingTop: 14,
          paddingBottom: 130,
        }}
      >
        {/* TOP BAR */}

        <div
          style={{
            position: 'relative',
            zIndex: 5,
            display: 'flex',
            alignItems: 'center',
            justifyContent:
              'space-between',
            marginBottom: 14,
          }}
        >
          <Link
            href="/missions"
            aria-label="Mission一覧へ戻る"
            style={{
              width: 38,
              height: 38,
              display: 'grid',
              placeItems: 'center',
              borderRadius: '50%',
              color: '#fff',
              background:
                'rgba(255,255,255,.07)',
              border:
                '1px solid rgba(255,255,255,.10)',
              textDecoration: 'none',
              backdropFilter:
                'blur(12px)',
            }}
          >
            <ArrowLeft
              size={18}
              strokeWidth={1.5}
            />
          </Link>

         
          <div
            style={{
              width: 38,
            }}
          />
        </div>

        {/* HERO */}

        <section
          style={{
            position: 'relative',
            minHeight: 420,
            overflow: 'hidden',
            borderRadius: 14,
            border:
              '1px solid rgba(255,255,255,.10)',
            boxShadow:
              '0 24px 60px rgba(0,0,0,.30)',
          }}
        >
         <div
  style={{
    position: 'absolute',
    inset: 0,
  }}
>
  <PersistentMissionImage
    missionId={mission.id}
    src={missionImageUrl}
    alt=""
    style={{
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      display: 'block',
    }}
  />
</div>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `
                linear-gradient(
                  to bottom,
                  rgba(5,5,10,.12) 0%,
                  rgba(5,5,10,.12) 30%,
                  rgba(5,5,10,.50) 65%,
                  rgba(5,5,10,.94) 100%
                )
              `,
            }}
          />

          <div
            style={{
              position: 'relative',
              zIndex: 2,
              minHeight: 420,
              padding: 20,
              display: 'flex',
              flexDirection:
                'column',
              justifyContent:
                'space-between',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems:
                  'center',
                justifyContent:
                  'space-between',
              }}
            >
              <span
                className="outingSerifEn"
                style={{
                  color: '#fff',
                  fontSize: 10,
                  letterSpacing:
                    '.18em',
                }}
              >
                DROP {dropNumber}
              </span>

              <span
                className="outingSerifEn"
                style={{
                  padding:
                    '7px 10px',
                  borderRadius: 999,
                  color: '#e0d4ff',
                  background:
                    'rgba(111,72,210,.30)',
                  border:
                    '1px solid rgba(190,166,255,.24)',
                  fontSize: 11,
                  letterSpacing:
                    '.08em',
                  backdropFilter:
                    'blur(10px)',
                }}
              >
                +{mission.points} PT
              </span>
            </div>

            <div>
              {cleared && (
                <div
                  style={{
                    display:
                      'inline-flex',
                    alignItems:
                      'center',
                    gap: 5,
                    marginBottom: 9,
                    color:
                      '#ded1ff',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing:
                      '.10em',
                  }}
                >
                  <CheckCircle2
                    size={13}
                  />
                  CLEAR
                </div>
              )}

              <h1
                className="outingSerifJa"
                style={{
                  margin: 0,
                  maxWidth: 390,
                  color: '#fff',
                  fontSize:
                    'clamp(29px, 8vw, 39px)',
                  fontWeight: 400,
                  lineHeight: 1.45,
                  letterSpacing:
                    '.04em',
                  textShadow:
                    '0 4px 20px rgba(0,0,0,.35)',
                }}
              >
                {mission.title}
              </h1>

                     </div>
          </div>
        </section>

        {/* DETAILS */}

        <section
          className="glassCardStrong"
          style={{
            marginTop: 12,
            padding: '6px 17px',
          }}
        >
          <DetailRow
            icon={
              <CheckCircle2
                size={17}
              />
            }
            label="達成条件"
          >
            写真を撮影して投稿
          </DetailRow>

          <Divider />

          <DetailRow
            icon={<Target size={17} />}
            label="達成状況"
          >
            {cleared
              ? 'CLEAR済み'
              : '未達成'}
          </DetailRow>
        </section>

        {/* CAMERA CTA */}

        <Link
          href={cameraHref}
          className="outingSans"
          style={{
            width: '100%',
            minHeight: 58,
            marginTop: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 9,
            borderRadius: 13,
            color: '#fff',
            textDecoration: 'none',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '.04em',
            background:
              'linear-gradient(135deg,#7b58dc,#6340c5)',
            border:
              '1px solid rgba(200,181,255,.20)',
            boxShadow:
              '0 15px 35px rgba(83,48,170,.30)',
          }}
        >
          <Camera
            size={18}
            strokeWidth={1.7}
          />

          {cleared
            ? 'もう一度撮影する'
            : 'このMissionを撮影する'}
        </Link>

        {cleared && (
          <p
            className="outingSans"
            style={{
              margin:
                '10px 0 0',
              textAlign: 'center',
              color:
                'rgba(255,255,255,.38)',
              fontSize: 10,
            }}
          >
            再撮影できます。
            追加ポイントはありません。
          </p>
        )}
      </div>

      {/* BOTTOM NAV */}

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

function DetailRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns:
          '30px 92px 1fr',
        alignItems: 'center',
        minHeight: 61,
      }}
    >
      <div
        style={{
          color:
            'rgba(205,190,255,.75)',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {icon}
      </div>

      <span
        className="outingSans"
        style={{
          color:
            'rgba(255,255,255,.42)',
          fontSize: 10,
        }}
      >
        {label}
      </span>

      <strong
        className="outingSans"
        style={{
          color:
            'rgba(255,255,255,.84)',
          fontSize: 11,
          fontWeight: 500,
          textAlign: 'right',
        }}
      >
        {children}
      </strong>
    </div>
  )
}

function Divider() {
  return (
    <div
      style={{
        height: 1,
        background:
          'rgba(255,255,255,.07)',
      }}
    />
  )
}