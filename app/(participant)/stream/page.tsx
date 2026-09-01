import LivePosts from '@/components/LivePosts'

export default function Stream() {
  return (
    <main className="shell grid">
      <div>
        <div className="brand">OUTING 2026</div>
        <h1>Stream</h1>
        <p className="muted">
          参加者の公開写真や、運営からのお知らせを時系列で表示します。
        </p>
      </div>

      <LivePosts mode="stream" />
    </main>
  )
}