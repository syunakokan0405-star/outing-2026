'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  ArrowLeft,
  BookOpen,
  HomeIcon,
  Images,
  Target,
  UserRound,
} from 'lucide-react'
import LivePosts from '@/components/LivePosts'
import { createClient } from '@/lib/supabase/client'

type ProfileCache = {
  name: string
  avatarPath: string
  savedAt: number
}

const PROFILE_CACHE_VERSION = 'outing-public-profile-v2'
const IMAGE_CACHE_NAME = 'outing-ui-images-v1'
const memoryCache = new Map<string, ProfileCache>()

function profileKey(participantId: string) {
  return `${PROFILE_CACHE_VERSION}:${participantId}`
}

function readProfileCache(participantId: string): ProfileCache | null {
  const key = profileKey(participantId)
  const memory = memoryCache.get(key)
  if (memory) return memory
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ProfileCache
    if (!parsed?.name) return null
    memoryCache.set(key, parsed)
    return parsed
  } catch {
    return null
  }
}

function writeProfileCache(participantId: string, value: ProfileCache) {
  const key = profileKey(participantId)
  memoryCache.set(key, value)
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

async function cachedAvatarUrl(
  participantId: string,
  avatarPath: string,
  signedUrl: string,
) {
  if (!('caches' in window)) return signedUrl

  const cache = await caches.open(IMAGE_CACHE_NAME)
  const stableUrl =
    `${window.location.origin}/__outing-cache/avatar/` +
    `${encodeURIComponent(participantId)}/` +
    `${encodeURIComponent(avatarPath)}`
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

export default function ParticipantProfile() {
  const params = useParams<{ id: string }>()
  const participantId = params.id
  const supabase = useMemo(() => createClient(), [])

  const [name, setName] = useState('Participant')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null

    async function loadAvatar(avatarPath: string) {
      if (!avatarPath) {
        if (!cancelled) setAvatarUrl('')
        return
      }

      const { data } = await supabase.storage
        .from('outing-photos')
        .createSignedUrl(avatarPath, 60 * 60)

      if (!data?.signedUrl || cancelled) return

      try {
        const url = await cachedAvatarUrl(
          participantId,
          avatarPath,
          data.signedUrl,
        )
        if (cancelled) return
        if (url.startsWith('blob:')) objectUrl = url
        setAvatarUrl(url)
      } catch {
        if (!cancelled) setAvatarUrl(data.signedUrl)
      }
    }

    async function load() {
      const cached = readProfileCache(participantId)

      if (cached) {
        setName(cached.name)
        setLoading(false)
        void loadAvatar(cached.avatarPath)
      }

      const { data, error: profileError } = await supabase
        .from('participants')
        .select('name,avatar_path')
        .eq('id', participantId)
        .maybeSingle()

      if (cancelled) return

      if (profileError || !data) {
        if (!cached) {
          setError('プロフィールを表示できませんでした。')
        }
        setLoading(false)
        return
      }

      const avatarPath = data.avatar_path ?? ''

      setName(data.name)
      setError('')
      setLoading(false)

      writeProfileCache(participantId, {
        name: data.name,
        avatarPath,
        savedAt: Date.now(),
      })

      await loadAvatar(avatarPath)
    }

    void load()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [participantId, supabase])

  return (
    <main
      className="participantUi"
      style={
        {
          '--participant-bg-image': 'url("/outing-bg.jpg")',
        } as React.CSSProperties
      }
    >
      <div className="participantContent" style={{ paddingBottom: 118 }}>
        <header style={{ paddingTop: 22, marginBottom: 18 }}>
          <Link
            href="/stream"
            className="outingSans"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              color: 'rgba(255,255,255,.62)',
              textDecoration: 'none',
              fontSize: 12,
              letterSpacing: '.08em',
            }}
          >
            <ArrowLeft size={15} strokeWidth={1.6} />
            STREAM
          </Link>

          <p
            className="outingSerifEn"
            style={{
              margin: '24px 0 0',
              color: 'rgba(255,255,255,.5)',
              fontSize: 10,
              letterSpacing: '.2em',
            }}
          >
            OUTING 2026
          </p>

          <h1
            className="outingSerifEn"
            style={{
              margin: '6px 0 0',
              color: '#fff',
              fontSize: 32,
              fontWeight: 500,
              lineHeight: 1,
              letterSpacing: '.12em',
            }}
          >
            PROFILE
          </h1>
        </header>

        <section
          className="glassCardStrong"
          style={{
            padding: '22px 18px',
            marginBottom: 28,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              flex: '0 0 72px',
              borderRadius: '50%',
              overflow: 'hidden',
              display: 'grid',
              placeItems: 'center',
              background:
                'linear-gradient(145deg, rgba(151,111,255,.28), rgba(255,255,255,.07))',
              border: '1px solid rgba(255,255,255,.16)',
              boxShadow: '0 12px 30px rgba(0,0,0,.25)',
            }}
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={`${name} avatar`}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: 'block',
                }}
              />
            ) : (
              <UserRound
                size={30}
                strokeWidth={1.35}
                style={{ color: 'rgba(255,255,255,.72)' }}
              />
            )}
          </div>

          <div style={{ minWidth: 0 }}>
            <p
              className="outingSerifEn"
              style={{
                margin: 0,
                color: 'rgba(255,255,255,.45)',
                fontSize: 9,
                letterSpacing: '.18em',
              }}
            >
              PARTICIPANT
            </p>

            <h2
              className="outingSerifJa"
              style={{
                margin: '5px 0 0',
                color: '#fff',
                fontSize: 23,
                fontWeight: 400,
                lineHeight: 1.35,
                overflowWrap: 'anywhere',
              }}
            >
              {loading ? 'Loading...' : name}
            </h2>

            <p
              className="outingSans"
              style={{
                margin: '6px 0 0',
                color: 'rgba(255,255,255,.55)',
                fontSize: 12,
              }}
            >
              Public Gallery
            </p>
          </div>
        </section>

        {error ? (
          <section className="glassCardStrong" style={{ padding: 18 }}>
            <p
              className="outingSans"
              style={{ margin: 0, color: 'rgba(255,255,255,.75)' }}
            >
              {error}
            </p>
          </section>
        ) : (
          <>
            <section style={{ marginBottom: 15 }}>
              <p
                className="outingSerifEn"
                style={{
                  margin: 0,
                  color: 'rgba(255,255,255,.45)',
                  fontSize: 9,
                  letterSpacing: '.2em',
                }}
              >
                MOMENTS
              </p>
              <h2
                className="outingSerifEn"
                style={{
                  margin: '5px 0 0',
                  color: '#fff',
                  fontSize: 25,
                  fontWeight: 500,
                  letterSpacing: '.08em',
                }}
              >
                GALLERY
              </h2>
              <p
                className="outingSans"
                style={{
                  margin: '7px 0 0',
                  color: 'rgba(255,255,255,.55)',
                  fontSize: 12,
                  lineHeight: 1.7,
                }}
              >
                この人がOuting 2026で投稿した写真。
              </p>
            </section>

            <LivePosts mode="gallery" participantId={participantId} />
          </>
        )}
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
