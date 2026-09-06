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
        <header
          style={{
            paddingTop: 18,
            marginBottom: 26,
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
            Stream
          </h1>

          <p
            className="uiMuted"
            style={{
              marginTop: 8,
              maxWidth: 350,
            }}
          >
            みんなの瞬間を、
            リアルタイムで。
          </p>
        </header>

        <section
          style={{
            paddingBottom: 120,
          }}
        >
          <LivePosts mode="stream" />
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