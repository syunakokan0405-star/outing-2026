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
    label: 'SCHEDULE',
    title: 'タイムスケジュール',
    icon: CalendarDays,
  },
  {
    type: 'packing',
    label: 'PACKING',
    title: '持ち物',
    icon: Package,
  },
  {
    type: 'rules',
    label: 'RULES',
    title: '注意事項',
    icon: CircleAlert,
  },
  {
    type: 'place',
    label: 'PLACE',
    title: '施設・集合場所',
    icon: MapPin,
  },
  {
    type: 'groups',
    label: 'GROUPS',
    title: '班分け',
    icon: UsersRound,
  },
  {
    type: 'other',
    label: 'INFORMATION',
    title: 'その他',
    icon: BookOpen,
  },
]

export default async function Guide() {
  const supabase = await createClient()
  const eventId =
    process.env.NEXT_PUBLIC_EVENT_ID

  if (!eventId) {
    return (
      <main className="participantUi">
        <div className="participantContent">
          <section
            className="glassCardStrong"
            style={{ padding: 18 }}
          >
            <p className="outingSerifEn">
              ERROR
            </p>

            <h1 className="outingSerifJa">
              設定エラー
            </h1>

            <p className="uiMuted outingSans">
              EVENT ID が設定されていません。
            </p>
          </section>
        </div>
      </main>
    )
  }

  /* =========================
      GUIDE CONTENT
  ========================= */

  const {
    data: sections,
    error,
  } = await supabase
    .from('guide_sections')
    .select(
      'id,section_type,title,body,sort_order',
    )
    .eq('event_id', eventId)
    .order('sort_order', {
      ascending: true,
    })

  /* =========================
      GUIDE HERO IMAGE
  ========================= */

  const { data: eventData } =
    await supabase
      .from('events')
      .select('guide_background_path')
      .eq('id', eventId)
      .maybeSingle()

  let guideImageUrl =
    '/outing-bg.jpg'

  const guideBackgroundPath =
    eventData?.guide_background_path ?? ''

  if (guideBackgroundPath) {
    const {
      data: signedBackground,
    } = await supabase.storage
      .from('outing-photos')
      .createSignedUrl(
        guideBackgroundPath,
        60 * 60,
      )

    if (signedBackground?.signedUrl) {
      guideImageUrl =
        signedBackground.signedUrl
    }
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
            marginBottom: 20,
          }}
        >
          <p
            className="outingSerifEn"
            style={{
              margin: 0,
              color:
                'rgba(255,255,255,.58)',
              fontSize: 11,
              letterSpacing: '.18em',
            }}
          >
            OUTING 2026
          </p>

          <h1
            className="outingSerifEn"
            style={{
              margin: '7px 0 0',
              color: '#fff',
              fontSize: 34,
              fontWeight: 500,
              lineHeight: 1,
              letterSpacing: '.14em',
            }}
          >
            GUIDE
          </h1>
        </header>

        {/* =========================
            HERO PHOTO
        ========================= */}

        <section
          style={{
            position: 'relative',
            overflow: 'hidden',
            width: '100%',
            aspectRatio: '16 / 9',
            marginBottom: 26,
            borderRadius: 18,

            border:
              '1px solid rgba(255,255,255,.10)',

            boxShadow:
              '0 18px 45px rgba(0,0,0,.26)',
          }}
        >
          <img
            src={guideImageUrl}
            alt=""
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
              objectFit: 'cover',
              objectPosition: 'center',
            }}
          />

          <div
            style={{
              position: 'absolute',
              inset: 0,

              background:
                'linear-gradient(to bottom, rgba(0,0,0,.02), rgba(0,0,0,.14))',

              pointerEvents: 'none',
            }}
          />
        </section>

        {/* =========================
            ERROR
        ========================= */}

        {error && (
          <section
            className="glassCardStrong"
            style={{
              padding: 18,
              marginBottom: 16,
            }}
          >
            <p
              className="outingSerifEn"
              style={{
                margin: 0,
                color:
                  'rgba(255,255,255,.55)',
                fontSize: 11,
                letterSpacing: '.16em',
              }}
            >
              ERROR
            </p>

            <h2
              className="outingSerifJa"
              style={{
                margin: '7px 0 8px',
                color: '#fff',
                fontSize: 18,
                fontWeight: 400,
              }}
            >
              Guideを読み込めませんでした
            </h2>

            <p className="uiMuted outingSans">
              {error.message}
            </p>
          </section>
        )}

        {/* =========================
            GUIDE SECTIONS
        ========================= */}

        {!error && (
          <section
            style={{
              paddingBottom: 110,
            }}
          >
            {categories.map(
              (
                category,
                categoryIndex,
              ) => {
                const categorySections =
                  sections?.filter(
                    (section) =>
                      section.section_type ===
                      category.type,
                  ) ?? []

                const Icon =
                  category.icon

                return (
                  <div
                    key={category.type}
                    style={{
                      borderTop:
                        categoryIndex === 0
                          ? '1px solid rgba(255,255,255,.08)'
                          : undefined,

                      borderBottom:
                        '1px solid rgba(255,255,255,.08)',
                    }}
                  >
                    <details>
                      <summary
                        style={{
                          listStyle: 'none',
                          cursor: 'pointer',

                          display: 'grid',

                          gridTemplateColumns:
                            '40px minmax(0,1fr) auto',

                          alignItems:
                            'center',

                          gap: 12,

                          padding:
                            '16px 2px',
                        }}
                      >
                        <span
                          style={{
                            width: 40,
                            height: 40,

                            display: 'grid',
                            placeItems:
                              'center',

                            borderRadius:
                              999,

                            background:
                              'rgba(128,84,220,.18)',

                            border:
                              '1px solid rgba(169,139,255,.16)',

                            color:
                              '#c1adff',
                          }}
                        >
                          <Icon
                            size={18}
                            strokeWidth={
                              1.6
                            }
                          />
                        </span>

                        <span
                          style={{
                            minWidth: 0,
                          }}
                        >
                          <span
                            className="outingSerifEn"
                            style={{
                              display:
                                'block',

                              color:
                                'rgba(255,255,255,.48)',

                              fontSize: 9,

                              fontWeight:
                                500,

                              letterSpacing:
                                '.18em',
                            }}
                          >
                            {category.label}
                          </span>

                          <strong
                            className="outingSerifJa"
                            style={{
                              display:
                                'block',

                              marginTop: 2,

                              color: '#fff',

                              fontSize: 16,

                              fontWeight:
                                400,

                              lineHeight:
                                1.5,
                            }}
                          >
                            {category.title}
                          </strong>
                        </span>

                        <ChevronDown
                          size={17}
                          strokeWidth={1.5}
                          style={{
                            color:
                              'rgba(255,255,255,.42)',
                          }}
                        />
                      </summary>

                      <div
                        style={{
                          padding:
                            '0 2px 18px 52px',
                        }}
                      >
                        {categorySections.length ===
                        0 ? (
                          <p
                            className="uiMuted outingSans"
                            style={{
                              margin:
                                '2px 0',

                              fontSize: 13,
                            }}
                          >
                            現在情報はありません。
                          </p>
                        ) : (
                          categorySections.map(
                            (
                              section,
                              index,
                            ) => (
                              <article
                                key={
                                  section.id
                                }
                                style={{
                                  padding:
                                    '14px 0',

                                  borderBottom:
                                    index ===
                                    categorySections.length -
                                      1
                                      ? 'none'
                                      : '1px solid rgba(255,255,255,.055)',
                                }}
                              >
                                <h2
                                  className="outingSerifJa"
                                  style={{
                                    margin: 0,

                                    color:
                                      '#fff',

                                    fontSize:
                                      15,

                                    fontWeight:
                                      400,

                                    lineHeight:
                                      1.55,
                                  }}
                                >
                                  {section.title}
                                </h2>

                                <p
                                  className="outingSans"
                                  style={{
                                    margin:
                                      '7px 0 0',

                                    whiteSpace:
                                      'pre-wrap',

                                    color:
                                      'rgba(255,255,255,.62)',

                                    fontSize:
                                      13,

                                    lineHeight:
                                      1.85,
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
                  </div>
                )
              },
            )}
          </section>
        )}
      </div>

      {/* =========================
          BOTTOM NAV
      ========================= */}

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