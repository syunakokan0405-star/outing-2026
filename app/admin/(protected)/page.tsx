import Link from 'next/link'
import {
  Bell,
  BookOpen,
  Camera,
  Image,
  Radio,
  ShieldCheck,
  Target,
  Trophy,
  Users,
} from 'lucide-react'

import AdminLogout from '@/components/auth/AdminLogout'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function Admin() {
  const supabase = await createClient()

  const eventId = process.env.NEXT_PUBLIC_EVENT_ID

  if (!eventId) {
    return (
      <main
        style={{
          minHeight: '100vh',
          background: '#0a0b10',
          color: '#fff',
          padding: 24,
        }}
      >
        <section
          style={{
            maxWidth: 760,
            margin: '80px auto',
            padding: 28,
            borderRadius: 24,
            background: 'rgba(255,255,255,.04)',
            border: '1px solid rgba(255,255,255,.08)',
          }}
        >
          <h2 style={{ marginTop: 0 }}>
            設定エラー
          </h2>

          <p
            style={{
              color: 'rgba(255,255,255,.55)',
            }}
          >
            NEXT_PUBLIC_EVENT_ID が設定されていません。
          </p>
        </section>
      </main>
    )
  }

  const [
    eventResult,
    participantsResult,
    postsResult,
    assignmentsResult,
    clearedResult,
    connectionsResult,
  ] = await Promise.all([
    supabase
      .from('events')
      .select('name,status')
      .eq('id', eventId)
      .maybeSingle(),

    supabase
      .from('participants')
      .select('*', {
        count: 'exact',
        head: true,
      })
      .eq('event_id', eventId)
      .eq('is_active', true),

    supabase
      .from('posts')
      .select('*', {
        count: 'exact',
        head: true,
      })
      .eq('event_id', eventId)
      .is('deleted_at', null),

    supabase
      .from('mission_assignments')
      .select(
        `
          id,
          mission:missions!inner(
            drop:mission_drops!inner(event_id)
          )
        `,
        {
          count: 'exact',
          head: true,
        },
      )
      .eq('mission.drop.event_id', eventId),

    supabase
      .from('mission_assignments')
      .select(
        `
          id,
          mission:missions!inner(
            drop:mission_drops!inner(event_id)
          )
        `,
        {
          count: 'exact',
          head: true,
        },
      )
      .eq('mission.drop.event_id', eventId)
      .not('first_cleared_at', 'is', null),

    supabase
      .from('connections')
      .select('*', {
        count: 'exact',
        head: true,
      })
      .eq('event_id', eventId),
  ])

  const participants =
    participantsResult.count ?? 0

  const posts =
    postsResult.count ?? 0

  const assignments =
    assignmentsResult.count ?? 0

  const cleared =
    clearedResult.count ?? 0

  const connections =
    connectionsResult.count ?? 0

  const clearRate =
    assignments > 0
      ? Math.round(
          (cleared / assignments) * 100,
        )
      : 0

  const eventStatus =
    eventResult.data?.status ?? 'unknown'

  const eventName =
    eventResult.data?.name ?? 'OUTING 2026'

  const stats = [
    {
      number: String(participants),
      label: 'PARTICIPANTS',
      sub: '参加者',
    },
    {
      number: String(posts),
      label: 'PHOTO POSTS',
      sub: '写真投稿',
    },
    {
      number: String(connections),
      label: 'CONNECTIONS',
      sub: 'つながり',
    },
    {
      number: `${clearRate}%`,
      label: 'MISSION CLEAR',
      sub: '達成率',
    },
  ]

  const actions = [
    {
      href: '/admin/missions',
      title: 'Mission Drop',
      description:
        'ミッション・Dropを作成、公開',
      icon: Target,
    },
    {
      href: '/admin/announcements',
      title: 'Announcements',
      description:
        '参加者へのお知らせを管理',
      icon: Bell,
    },
    {
      href: '/admin/home-backgrounds',
      title: 'Display Images',
      description:
        'ランキング・お知らせ・Guide画像',
      icon: Image,
    },
    {
      href: '/admin/stream',
      title: 'Stream',
      description:
        '運営からStreamへ投稿',
      icon: Radio,
    },
    {
      href: '/admin/photos',
      title: 'Photos',
      description:
        '参加者の写真投稿を確認・管理',
      icon: Camera,
    },
    {
      href: '/admin/guide',
      title: 'Guide',
      description:
        'イベント案内を編集',
      icon: BookOpen,
    },
    {
      href: '/admin/awards',
      title: 'Awards',
      description:
        '表彰・受賞者を管理',
      icon: Trophy,
    },
    {
      href: '/admin/participants',
      title: 'Participants',
      description:
        '参加者名簿・アカウント管理',
      icon: Users,
    },
    {
      href: '/admin/admins',
      title: 'Administrators',
      description:
        '運営メンバーと権限を管理',
      icon: ShieldCheck,
    },
  ]

  return (
    <main
      className="outingSans"
      style={{
        minHeight: '100vh',
        background:
          'linear-gradient(180deg,#0b0c12 0%,#11131b 100%)',
        color: '#fff',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 1180,
          margin: '0 auto',
          padding:
            '36px 24px 64px',
        }}
      >
        {/* HEADER */}
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent:
              'space-between',
            gap: 20,
            marginBottom: 38,
          }}
        >
          <div>
            <p
              className="outingSerifEn"
              style={{
                margin: 0,
                color:
                  'rgba(255,255,255,.45)',
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: '.18em',
              }}
            >
              OUTING 2026
            </p>

            <h1
              className="outingSerifEn"
              style={{
                margin: '8px 0 0',
                fontSize: 36,
                lineHeight: 1,
                fontWeight: 500,
                letterSpacing: '.08em',
              }}
            >
              ADMIN
            </h1>

            <p
              style={{
                margin: '10px 0 0',
                color:
                  'rgba(255,255,255,.42)',
                fontSize: 12,
              }}
            >
              {eventName}
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 999,
                background:
                  eventStatus === 'published'
                    ? 'rgba(34,197,94,.10)'
                    : 'rgba(139,92,246,.10)',
                border:
                  eventStatus === 'published'
                    ? '1px solid rgba(34,197,94,.18)'
                    : '1px solid rgba(139,92,246,.18)',
                color:
                  eventStatus === 'published'
                    ? '#86efac'
                    : '#c4b5fd',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '.08em',
              }}
            >
              {eventStatus.toUpperCase()}
            </div>

            <AdminLogout />
          </div>
        </header>

        {/* OVERVIEW */}
        <section
          style={{
            marginBottom: 38,
          }}
        >
          <div
            style={{
              marginBottom: 14,
            }}
          >
            <p
              className="outingSerifEn"
              style={{
                margin: 0,
                color:
                  'rgba(255,255,255,.35)',
                fontSize: 10,
                letterSpacing: '.16em',
              }}
            >
              EVENT OVERVIEW
            </p>

            <h2
              style={{
                margin: '5px 0 0',
                fontSize: 18,
                fontWeight: 600,
              }}
            >
              現在の状況
            </h2>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit,minmax(180px,1fr))',
              gap: 12,
            }}
          >
            {stats.map(
              ({
                number,
                label,
                sub,
              }) => (
                <div
                  key={label}
                  style={{
                    padding: 20,
                    borderRadius: 20,
                    background:
                      'rgba(255,255,255,.035)',
                    border:
                      '1px solid rgba(255,255,255,.07)',
                  }}
                >
                  <div
                    style={{
                      color:
                        'rgba(255,255,255,.36)',
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: '.11em',
                    }}
                  >
                    {label}
                  </div>

                  <div
                    style={{
                      marginTop: 10,
                      fontSize: 32,
                      lineHeight: 1,
                      fontWeight: 700,
                    }}
                  >
                    {number}
                  </div>

                  <div
                    style={{
                      marginTop: 8,
                      color:
                        'rgba(255,255,255,.42)',
                      fontSize: 11,
                    }}
                  >
                    {sub}
                  </div>
                </div>
              ),
            )}
          </div>
        </section>

        {/* MANAGEMENT */}
        <section>
          <div
            style={{
              marginBottom: 14,
            }}
          >
            <p
              className="outingSerifEn"
              style={{
                margin: 0,
                color:
                  'rgba(255,255,255,.35)',
                fontSize: 10,
                letterSpacing: '.16em',
              }}
            >
              MANAGEMENT
            </p>

            <h2
              style={{
                margin: '5px 0 0',
                fontSize: 18,
                fontWeight: 600,
              }}
            >
              管理メニュー
            </h2>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit,minmax(260px,1fr))',
              gap: 12,
            }}
          >
            {actions.map(
              ({
                href,
                title,
                description,
                icon: Icon,
              }) => (
                <Link
                  key={href}
                  href={href}
                  style={{
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <div
                    style={{
                      minHeight: 118,
                      padding: 20,
                      borderRadius: 20,
                      background:
                        'rgba(255,255,255,.035)',
                      border:
                        '1px solid rgba(255,255,255,.07)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 16,
                    }}
                  >
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 14,
                        display: 'grid',
                        placeItems: 'center',
                        flexShrink: 0,
                        background:
                          'rgba(139,92,246,.10)',
                        border:
                          '1px solid rgba(167,139,250,.12)',
                        color: '#b9a4ff',
                      }}
                    >
                      <Icon size={20} />
                    </div>

                    <div
                      style={{
                        minWidth: 0,
                      }}
                    >
                      <div
                        className="outingSerifEn"
                        style={{
                          fontSize: 18,
                          fontWeight: 500,
                          letterSpacing:
                            '.04em',
                        }}
                      >
                        {title}
                      </div>

                      <div
                        style={{
                          marginTop: 5,
                          color:
                            'rgba(255,255,255,.40)',
                          fontSize: 11,
                          lineHeight: 1.6,
                        }}
                      >
                        {description}
                      </div>
                    </div>
                  </div>
                </Link>
              ),
            )}
          </div>
        </section>
      </div>
    </main>
  )
}