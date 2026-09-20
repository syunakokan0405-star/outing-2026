'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  ChevronDown,
  HomeIcon,
  Images,
  MapPin,
  PackageCheck,
  ShieldCheck,
  Target,
  UserRound,
  UsersRound,
  CalendarDays,
  CircleEllipsis,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type GuideSection = {
  id: string
  section_type: string
  title: string
  body: string
  sort_order: number
}

type GuideCache = {
  sections: GuideSection[]
  guideBackgroundPath: string
  savedAt: number
}

const EVENT_ID = process.env.NEXT_PUBLIC_EVENT_ID ?? ''
const DATA_CACHE_VERSION = 'outing-guide-v2'
const IMAGE_CACHE_NAME = 'outing-ui-images-v1'
const memoryCache = new Map<string, GuideCache>()

const categories = [
  { type: 'schedule', label: 'SCHEDULE', title: 'スケジュール', icon: CalendarDays },
  { type: 'packing', label: 'PACKING', title: '持ち物', icon: PackageCheck },
  { type: 'rules', label: 'RULES', title: 'ルール', icon: ShieldCheck },
  { type: 'place', label: 'PLACE', title: '場所・施設', icon: MapPin },
  { type: 'groups', label: 'GROUPS', title: 'グループ', icon: UsersRound },
  { type: 'other', label: 'OTHER', title: 'その他', icon: CircleEllipsis },
] as const

function dataCacheKey(eventId: string) {
  return `${DATA_CACHE_VERSION}:${eventId}`
}

function readDataCache(eventId: string): GuideCache | null {
  const key = dataCacheKey(eventId)
  const memory = memoryCache.get(key)
  if (memory) return memory

  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as GuideCache
    if (!Array.isArray(parsed?.sections)) return null
    memoryCache.set(key, parsed)
    return parsed
  } catch {
    return null
  }
}

function writeDataCache(eventId: string, value: GuideCache) {
  const key = dataCacheKey(eventId)
  memoryCache.set(key, value)
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

async function getCachedUiImage(
  stableId: string,
  signedUrl: string,
): Promise<string> {
  if (!('caches' in window)) return signedUrl

  const cache = await caches.open(IMAGE_CACHE_NAME)
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

export default function GuidePage() {
  const supabase = useMemo(() => createClient(), [])
  const [sections, setSections] = useState<GuideSection[]>([])
  const [guideImageUrl, setGuideImageUrl] = useState('/outing-bg.jpg')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null

    async function applyBackground(path: string) {
      if (!path) {
        if (!cancelled) setGuideImageUrl('/outing-bg.jpg')
        return
      }

      const { data, error: signError } = await supabase.storage
        .from('outing-photos')
        .createSignedUrl(path, 60 * 60)

      if (signError || !data?.signedUrl || cancelled) return

      try {
        const url = await getCachedUiImage(
          `guide:${EVENT_ID}:${path}`,
          data.signedUrl,
        )

        if (cancelled) {
          if (url.startsWith('blob:')) URL.revokeObjectURL(url)
          return
        }

        if (objectUrl) URL.revokeObjectURL(objectUrl)
        objectUrl = url.startsWith('blob:') ? url : null
        setGuideImageUrl(url)
      } catch {
        if (!cancelled) setGuideImageUrl(data.signedUrl)
      }
    }

    async function load() {
      if (!EVENT_ID) {
        setError('イベントIDが設定されていません。')
        setLoading(false)
        return
      }

      const cached = readDataCache(EVENT_ID)
      if (cached) {
        setSections(cached.sections)
        setLoading(false)
        void applyBackground(cached.guideBackgroundPath)
      }

      const [sectionsResult, eventResult] = await Promise.all([
        supabase
          .from('guide_sections')
          .select('id,section_type,title,body,sort_order')
          .eq('event_id', EVENT_ID)
          .order('sort_order', { ascending: true }),
        supabase
          .from('events')
          .select('guide_background_path')
          .eq('id', EVENT_ID)
          .maybeSingle(),
      ])

      if (cancelled) return

      if (sectionsResult.error) {
        if (!cached) {
          setError('Guideを読み込めませんでした。')
          setLoading(false)
        }
        return
      }

      const nextSections = (sectionsResult.data ?? []) as GuideSection[]
      const backgroundPath =
        eventResult.data?.guide_background_path ?? ''

      setSections(nextSections)
      setError('')
      setLoading(false)

      writeDataCache(EVENT_ID, {
        sections: nextSections,
        guideBackgroundPath: backgroundPath,
        savedAt: Date.now(),
      })

      await applyBackground(backgroundPath)
    }

    void load()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [supabase])

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
        <header style={{ paddingTop: 24, marginBottom: 20 }}>
          <p
            className="outingSerifEn"
            style={{
              margin: 0,
              color: 'rgba(255,255,255,.58)',
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

        <section
          style={{
            position: 'relative',
            overflow: 'hidden',
            width: '100%',
            aspectRatio: '16 / 9',
            marginBottom: 26,
            borderRadius: 18,
            border: '1px solid rgba(255,255,255,.10)',
            boxShadow: '0 18px 45px rgba(0,0,0,.26)',
          }}
        >
          <img
            src={guideImageUrl}
            alt=""
            decoding="async"
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
                'linear-gradient(to bottom, rgba(0,0,0,.02), rgba(0,0,0,.34))',
              pointerEvents: 'none',
            }}
          />
        </section>

        {error && (
          <section
            className="glassCardStrong"
            style={{ padding: 18, marginBottom: 16 }}
          >
            <p
              className="outingSerifEn"
              style={{
                margin: 0,
                color: 'rgba(255,255,255,.55)',
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
            <p className="uiMuted outingSans" style={{ margin: 0 }}>
              {error}
            </p>
          </section>
        )}

        {!error && (
          <section style={{ paddingBottom: 110 }}>
            {loading && sections.length === 0 ? (
              <section
                className="glassCardStrong"
                style={{ padding: 18 }}
              >
                <p
                  className="outingSans"
                  style={{
                    margin: 0,
                    color: 'rgba(255,255,255,.6)',
                    fontSize: 13,
                  }}
                >
                  Guideを読み込んでいます...
                </p>
              </section>
            ) : (
              categories.map((category, categoryIndex) => {
                const categorySections = sections.filter(
                  (section) =>
                    section.section_type === category.type,
                )
                const Icon = category.icon

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
                          alignItems: 'center',
                          gap: 12,
                          padding: '16px 2px',
                        }}
                      >
                        <span
                          style={{
                            width: 40,
                            height: 40,
                            display: 'grid',
                            placeItems: 'center',
                            borderRadius: 999,
                            background: 'rgba(128,84,220,.18)',
                            border:
                              '1px solid rgba(169,139,255,.16)',
                            color: '#c1adff',
                          }}
                        >
                          <Icon size={18} strokeWidth={1.6} />
                        </span>

                        <span style={{ minWidth: 0 }}>
                          <span
                            className="outingSerifEn"
                            style={{
                              display: 'block',
                              color: 'rgba(255,255,255,.48)',
                              fontSize: 9,
                              fontWeight: 500,
                              letterSpacing: '.18em',
                            }}
                          >
                            {category.label}
                          </span>

                          <strong
                            className="outingSerifJa"
                            style={{
                              display: 'block',
                              marginTop: 2,
                              color: '#fff',
                              fontSize: 16,
                              fontWeight: 400,
                              lineHeight: 1.5,
                            }}
                          >
                            {category.title}
                          </strong>
                        </span>

                        <ChevronDown
                          size={17}
                          strokeWidth={1.5}
                          style={{
                            color: 'rgba(255,255,255,.42)',
                          }}
                        />
                      </summary>

                      <div style={{ padding: '0 2px 18px 52px' }}>
                        {categorySections.length === 0 ? (
                          <p
                            className="uiMuted outingSans"
                            style={{ margin: '2px 0', fontSize: 13 }}
                          >
                            現在情報はありません。
                          </p>
                        ) : (
                          categorySections.map((section, index) => (
                            <article
                              key={section.id}
                              style={{
                                padding: '14px 0',
                                borderBottom:
                                  index ===
                                  categorySections.length - 1
                                    ? 'none'
                                    : '1px solid rgba(255,255,255,.07)',
                              }}
                            >
                              <h2
                                className="outingSerifJa"
                                style={{
                                  margin: 0,
                                  color: '#fff',
                                  fontSize: 15,
                                  fontWeight: 400,
                                  lineHeight: 1.55,
                                }}
                              >
                                {section.title}
                              </h2>

                              <p
                                className="outingSans"
                                style={{
                                  margin: '7px 0 0',
                                  whiteSpace: 'pre-wrap',
                                  color: 'rgba(255,255,255,.62)',
                                  fontSize: 13,
                                  lineHeight: 1.85,
                                }}
                              >
                                {section.body}
                              </p>
                            </article>
                          ))
                        )}
                      </div>
                    </details>
                  </div>
                )
              })
            )}
          </section>
        )}
      </div>

      <nav className="outingNav">
        <Link href="/">
          <HomeIcon />
          <span>Home</span>
        </Link>

        <Link href="/guide" className="active">
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
