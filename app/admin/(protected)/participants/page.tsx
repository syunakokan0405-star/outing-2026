import ParticipantManager from '@/components/auth/ParticipantManager'
import { getEventId, requireAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function ParticipantsPage() {
  const admin = await requireAdmin()
  if (!(admin.role === 'owner' || admin.role === 'admin' || admin.can_manage_participants)) {
    return <main style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}><div className="card"><h1>権限がありません</h1><p className="muted">参加者管理権限を持つ運営のみ操作できます。</p></div></main>
  }
  return <main style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}><ParticipantManager eventId={getEventId()} /></main>
}
