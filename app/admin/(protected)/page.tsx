import Link from 'next/link'
import AdminLogout from '@/components/auth/AdminLogout'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function Admin() {
  const supabase = await createClient()

  const eventId = process.env.NEXT_PUBLIC_EVENT_ID

  if (!eventId) {
    return (
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
        <section className="card">
          <h2>設定エラー</h2>
          <p>NEXT_PUBLIC_EVENT_ID が設定されていません。</p>
        </section>
      </main>
    )
  }

  const [
    eventResult,
    participantsResult,
    postsResult,
    assignmentsResult,
    clearedResult,
    connectionsResult,
  ] = await Promise.all([
    supabase
      .from('events')
      .select('name,status')
      .eq('id', eventId)
      .maybeSingle(),

    supabase
      .from('participants')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('is_active', true),

    supabase
      .from('posts')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .is('deleted_at', null),

    supabase
      .from('mission_assignments')
      .select(`
        id,
        mission:missions!inner(
          drop:mission_drops!inner(event_id)
        )
      `, { count: 'exact', head: true })
      .eq('mission.drop.event_id', eventId),

    supabase
      .from('mission_assignments')
      .select(`
        id,
        mission:missions!inner(
          drop:mission_drops!inner(event_id)
        )
      `, { count: 'exact', head: true })
      .eq('mission.drop.event_id', eventId)
      .not('first_cleared_at', 'is', null),

    supabase
      .from('connections')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', eventId),
  ])

  const participants = participantsResult.count ?? 0
  const posts = postsResult.count ?? 0
  const assignments = assignmentsResult.count ?? 0
  const cleared = clearedResult.count ?? 0
  const connections = connectionsResult.count ?? 0

  const clearRate =
    assignments > 0
      ? Math.round((cleared / assignments) * 100)
      : 0

  const eventStatus = eventResult.data?.status ?? 'unknown'

  const stats = [
    [String(participants), '参加者'],
    [String(posts), '写真投稿'],
    [String(connections), 'Connections'],
    [`${clearRate}%`, 'Mission CLEAR'],
  ]

  return (
    <main
      style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}
      className="grid"
    >
      <div className="row">
        <div>
          <div className="brand">OUTING 2026</div>
          <h1>Admin Dashboard</h1>
        </div>

        <div className="row">
          <span>EVENT: {eventStatus.toUpperCase()}</span>
          <AdminLogout />
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
          gap: 12,
        }}
      >
        {stats.map(([n, l]) => (
          <div className="card" key={l}>
            <div className="muted">{l}</div>
            <div className="stat">{n}</div>
          </div>
        ))}
      </div>

      <section className="card">
        <h2>Quick Actions</h2>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
            gap: 10,
          }}
        >
  <Link href="/admin/missions">
  <button className="btn primary">🔥 Mission Drop</button>
</Link>

<Link href="/admin/stream">
  <button className="btn outline">📣 Stream投稿</button>
</Link>

<Link href="/admin/photos">
  <button className="btn outline">📷 写真管理</button>
</Link>

<Link href="/admin/guide">
  <button className="btn outline">📅 Guide編集</button>
</Link>

<Link href="/admin/admins">
  <button className="btn outline">🛡️ 管理者管理</button>
</Link>

<Link href="/admin/participants">
  <button className="btn outline">👥 参加者管理</button>
</Link>
        </div>
      </section>
    </main>
  )
}
