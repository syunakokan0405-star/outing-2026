import Link from 'next/link'
import PointTop5 from '@/components/PointTop5'

export const dynamic = 'force-dynamic'

export default function Home() {
  return (
    <main className="shell grid">
      <div>
        <div className="brand">OUTING 2026</div>
        <h1>Home</h1>
      </div>

      <section className="card">
        <div className="muted">MISSION</div>
        <h2>現在のMissionを確認</h2>
        <p className="muted">
          自分に割り当てられたMissionを確認して、写真を投稿しよう。
        </p>

        <Link href="/missions">
          <button className="btn primary">
            Missionを見る
          </button>
        </Link>
      </section>

      <section className="card">
        <div className="muted">STREAM</div>
        <h2>最新情報をチェック</h2>
        <p className="muted">
          運営からのお知らせやイベント中の投稿を確認できます。
        </p>

        <Link href="/stream">
          <button className="btn">
            Streamを見る
          </button>
        </Link>
      </section>

      <PointTop5 />

      <nav className="nav">
        <Link className="active" href="/">
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