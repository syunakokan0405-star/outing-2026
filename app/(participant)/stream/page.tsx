import Link from 'next/link'
import {
  BookOpen,
  HomeIcon,
  Images,
  Target,
  UserRound,
} from 'lucide-react'

import LivePosts from '@/components/LivePosts'

export default function Stream() {
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
            marginBottom: 26,
          }}
        >
          <p
            className="outingSerifEn"
            style={{
              margin: 0,
              color:
                'rgba(255,255,255,.58)',
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
              margin: '7px 0 0',
              color: '#fff',
              fontSize: 34,
              fontWeight: 500,
              lineHeight: 1,
              letterSpacing: '.14em',
            }}
          >
            STREAM
          </h1>

          <p
            className="outingSerifJa"
            style={{
              margin: '11px 0 0',
              maxWidth: 350,
              color:
                'rgba(255,255,255,.58)',
              fontSize: 13,
              fontWeight: 400,
              lineHeight: 1.7,
              letterSpacing: '.06em',
            }}
          >
            みんなの瞬間を、リアルタイムで。
          </p>
        </header>

        {/* =========================
            POSTS
        ========================= */}

        <section
          className="outingSans"
          style={{
            paddingBottom: 120,
          }}
        >
          <LivePosts mode="stream" />
        </section>
      </div>

      {/* =========================
          BOTTOM NAV
      ========================= */}

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

        <Link
          href="/stream"
          className="active"
        >
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