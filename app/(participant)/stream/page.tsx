
import ParticipantHeader from '@/components/ParticipantHeader'
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

        <ParticipantHeader title="STREAM" />
        <p className="outingSerifJa" style={{ margin: "-9px 0 26px", color: "rgba(255,255,255,.58)", fontSize: 13, lineHeight: 1.7 }}>みんなの瞬間を、リアルタイムで。</p>

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