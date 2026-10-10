import { getEventId, requireAdmin } from '@/lib/auth'
import PointManager from '@/components/admin/PointManager'

export const dynamic = 'force-dynamic'

export default async function AdminPointsPage() {
  const admin = await requireAdmin()
  if (!['owner', 'admin'].includes(admin.role)) {
    return <main className="card" style={{ margin: 24 }}>ポイント調整は管理者のみ操作できます。</main>
  }
  return <PointManager eventId={getEventId()} />
}
