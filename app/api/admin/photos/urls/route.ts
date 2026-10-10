import { NextResponse } from 'next/server'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { r2, R2_BUCKET_NAME } from '@/lib/r2'
import { getEventId } from '@/lib/auth'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'ログインしてください。' }, { status: 401 })
    const eventId = getEventId()
    const { data: admin, error } = await supabase.from('admin_users')
      .select('role,can_manage_photos').eq('event_id', eventId).eq('auth_user_id', user.id).maybeSingle()
    if (error || !admin || (!['owner', 'admin'].includes(admin.role) && !admin.can_manage_photos)) {
      return NextResponse.json({ error: '写真管理権限が必要です。' }, { status: 403 })
    }
    const body = await request.json().catch(() => null)
    const ids = body?.postIds
    if (!Array.isArray(ids) || ids.length > 60 || ids.some(id => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))) {
      return NextResponse.json({ error: '投稿IDを確認してください。' }, { status: 400 })
    }
    if (!ids.length) return NextResponse.json({ urls: {} })
    // Privileged reads are scoped to the configured event only after the above
    // session and photo-permission checks. Participants never reach this client.
    const db = createAdminClient()
    const { data: posts, error: postError } = await db.from('posts')
      .select('id,image_path,storage_provider,r2_object_key,r2_thumbnail_key,deleted_at,admin_post_recovery(post_id)')
      .eq('event_id', eventId).in('id', [...new Set(ids)])
    if (postError) throw postError
    const allowed = (posts ?? []).filter(p => !p.deleted_at || p.admin_post_recovery !== null)
    const entries = await Promise.all(allowed.map(async post => {
      if (post.storage_provider === 'r2') {
        const key = post.r2_thumbnail_key || post.r2_object_key
        if (!key) return null
        const url = await getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }), { expiresIn: 3600 })
        return [post.id, url] as const
      }
      if (!post.image_path) return null
      const { data, error } = await db.storage.from('outing-photos').createSignedUrl(post.image_path, 3600)
      if (error || !data?.signedUrl) return null
      return [post.id, data.signedUrl] as const
    }))
    return NextResponse.json({ urls: Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null)) }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('Admin photo URL error:', error)
    return NextResponse.json({ error: '写真を取得できませんでした。' }, { status: 500 })
  }
}
