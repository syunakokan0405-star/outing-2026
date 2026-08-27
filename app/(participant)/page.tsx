import Link from 'next/link'
import PointTop5 from '@/components/PointTop5'

export const dynamic='force-dynamic'

export default function Home(){return <main className="shell grid">
  <div><div className="brand">OUTING 2026</div><h1>Home</h1></div>
  <section className="card"><div className="muted">NEXT EVENT</div><h2>交流会 🌿</h2><div className="row"><b>15:00 START</b><span>📍 多目的ホール</span></div></section>
  <section className="card"><div className="muted">🔥 NEW DROP</div><h2>新しいMissionが追加されました</h2><Link href="/missions"><button className="btn primary">Missionを見る</button></Link></section>
  <PointTop5 />
  <nav className="nav"><Link className="active" href="/">HOME</Link><Link href="/guide">GUIDE</Link><Link href="/missions">📷</Link><Link href="/stream">STREAM</Link><Link href="/me">MY</Link></nav>
</main>}
