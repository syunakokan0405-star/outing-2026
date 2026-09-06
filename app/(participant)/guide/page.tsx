import Link from 'next/link'
import {
  BookOpen,
  CalendarDays,
  CircleAlert,
  HomeIcon,
  Images,
  MapPin,
  Package,
  Target,
  UserRound,
  UsersRound,
  ChevronDown,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const categories = [
  {
    type: 'schedule',
    label: 'Schedule',
    subtitle: '当日のスケジュール',
    icon: CalendarDays,
  },
  {
    type: 'packing',
    label: '持ち物',
    subtitle: '必要なもの・準備物',
    icon: Package,
  },
  {
    type: 'rules',
    label: '注意事項',
    subtitle: 'ルール・確認事項',
    icon: CircleAlert,
  },
  {
    type: 'place',
    label: '施設・集合場所',
    subtitle: '場所・アクセス情報',
    icon: MapPin,
  },
  {
    type: 'groups',
    label: '班分け',
    subtitle: 'グループ・チーム情報',
    icon: UsersRound,
  },
  {
    type: 'other',
    label: 'その他',
    subtitle: 'しおり全文・追加情報',
    icon: BookOpen,
  },
]

export default async function Guide() {
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
          <section className="glassCardStrong">
            <p className="uiEyebrow">ERROR</p>
            <h1 className="uiTitle">
              設定エラー
            </h1>
            <p className="uiMuted">
              EVENT ID が設定されていません。
            </p>
          </section>
        </div>
      </main>
    )
  }

  const { data: sections, error } = await supabase
    .from('guide_sections')
    .select(
      'id,section_type,title,body,sort_order',
    )
    .eq('event_id', eventId)
    .order('sort_order', {
      ascending: true,
    })

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
            marginBottom: 30,
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
            Guide
          </h1>

          <p
            className="uiMuted"
            style={{
              marginTop: 8,
              maxWidth: 340,
            }}
          >
            当日のスケジュールや持ち物、
            集合場所などを確認できます。
          </p>
        </header>

        {error && (
          <section
            className="glassCardStrong"
            style={{
              padding: 18,
              marginBottom: 16,
            }}
          >
            <p className="uiEyebrow">
              ERROR
            </p>

            <h2
              style={{
                margin: '6px 0 8px',
                fontSize: 18,
              }}
            >
              Guideを読み込めませんでした
            </h2>

            <p className="uiMuted">
              {error.message}
            </p>
          </section>
        )}

        {!error && (
          <section
            style={{
              display: 'grid',
              gap: 12,
              paddingBottom: 110,
            }}
          >
            {categories.map((category) => {
              const categorySections =
                sections?.filter(
                  (section) =>
                    section.section_type ===
                    category.type,
                ) ?? []

              const Icon = category.icon

              return (
                <details
                  key={category.type}
                  className="glassCardStrong"
                  style={{
                    overflow: 'hidden',
                  }}
                >
                  <summary
                    style={{
                      listStyle: 'none',
                      cursor: 'pointer',
                      display: 'grid',
                      gridTemplateColumns:
                        '44px minmax(0,1fr) auto',
                      alignItems: 'center',
                      gap: 12,
                      padding: '16px 16px',
                    }}
                  >
                    <span
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 14,
                        display: 'grid',
                        placeItems: 'center',
                        background:
                          'rgba(139,92,246,.12)',
                        border:
                          '1px solid rgba(167,139,250,.14)',
                        color: '#b7a0ff',
                      }}
                    >
                      <Icon
                        size={20}
                        strokeWidth={1.7}
                      />
                    </span>

                    <span
                      style={{
                        minWidth: 0,
                      }}
                    >
                      <strong
                        style={{
                          display: 'block',
                          color: '#fff',
                          fontSize: 15,
                          fontWeight: 700,
                        }}
                      >
                        {category.label}
                      </strong>

                      <span
                        style={{
                          display: 'block',
                          marginTop: 3,
                          color:
                            'rgba(255,255,255,.46)',
                          fontSize: 11,
                        }}
                      >
                        {category.subtitle}
                      </span>
                    </span>

                    <ChevronDown
                      size={18}
                      strokeWidth={1.7}
                      style={{
                        color:
                          'rgba(255,255,255,.48)',
                      }}
                    />
                  </summary>

                  <div
                    style={{
                      borderTop:
                        '1px solid rgba(255,255,255,.07)',
                      padding:
                        '4px 16px 18px',
                    }}
                  >
                    {categorySections.length ===
                    0 ? (
                      <p
                        className="uiMuted"
                        style={{
                          margin:
                            '16px 0 2px',
                          fontSize: 13,
                        }}
                      >
                        現在情報はありません。
                      </p>
                    ) : (
                      categorySections.map(
                        (section, index) => (
                          <article
                            key={section.id}
                            style={{
                              padding:
                                '17px 0',
                              borderBottom:
                                index ===
                                categorySections.length -
                                  1
                                  ? 'none'
                                  : '1px solid rgba(255,255,255,.06)',
                            }}
                          >
                            <h2
                              style={{
                                margin: 0,
                                color: '#fff',
                                fontSize: 16,
                                fontWeight: 700,
                                letterSpacing:
                                  '-.01em',
                              }}
                            >
                              {section.title}
                            </h2>

                            <p
                              style={{
                                margin:
                                  '9px 0 0',
                                whiteSpace:
                                  'pre-wrap',
                                color:
                                  'rgba(255,255,255,.68)',
                                fontSize: 13,
                                lineHeight: 1.8,
                              }}
                            >
                              {section.body}
                            </p>
                          </article>
                        ),
                      )
                    )}
                  </div>
                </details>
              )
            })}
          </section>
        )}
      </div>

      <nav className="outingNav">
        <Link href="/">
          <HomeIcon />
          <span>Home</span>
        </Link>

        <Link
          href="/guide"
          className="active"
        >
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