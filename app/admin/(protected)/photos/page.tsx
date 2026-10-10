import { getEventId, requireAdmin } from '@/lib/auth'
import PhotoManager from '@/components/admin/PhotoManager'

export const dynamic = 'force-dynamic'

export default async function AdminPhotosPage() {
  const admin = await requireAdmin()
  if (!['owner', 'admin'].includes(admin.role) && !admin.can_manage_photos) {
    return <main className="card" style={{ margin: 24 }}>写真管理権限が必要です。</main>
  }
  return <PhotoManager eventId={getEventId()} />
}
