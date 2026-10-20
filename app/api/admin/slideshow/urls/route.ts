import { NextResponse } from 'next/server'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getCurrentAdmin, getEventId } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { r2, R2_BUCKET_NAME } from '@/lib/r2'

export const runtime = 'nodejs'
const NO_CACHE = { 'Cache-Control': 'private, no-store' }
const TEST_MISSION_ID = '9d463703-db42-4fa1-b36a-737931c3fb5b'

export async function POST(request: Request) {
  try {
    const admin = await getCurrentAdmin()
    if (!admin || (!['owner', 'admin'].includes(admin.role) && !admin.can_manage_photos)) {
      return NextResponse.json({ error: '写真管理権限が必要です。' }, { status: 403, headers: NO_CACHE })
    }
    const body = await request.json().catch(() => null)
    const ids = body?.postIds
    if (!Array.isArray(ids) || ids.length > 20 ||
      ids.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id))) {
      return NextResponse.json({ error: '投稿IDを確認してください。' }, { status: 400, headers: NO_CACHE })
    }
    if (!ids.length) return NextResponse.json({ urls: {} }, { headers: NO_CACHE })
    const db = createAdminClient()
    const eventId = getEventId()
    const [postsResult, hiddenResult] = await Promise.all([
      db.from('posts')
        .select('id,mission_id,image_path,storage_provider,r2_object_key')
        .eq('event_id', eventId).eq('visibility', 'stream')
        .is('deleted_at', null).in('id', [...new Set(ids)]),
      db.from('slideshow_hidden_posts').select('post_id')
        .eq('event_id', eventId).in('post_id', [...new Set(ids)]),
    ])
    if (postsResult.error) throw postsResult.error
    if (hiddenResult.error) throw hiddenResult.error
    const hidden = new Set((hiddenResult.data ?? []).map(p => p.post_id))
    const entries = await Promise.all((postsResult.data ?? [])
      .filter(p => p.mission_id !== TEST_MISSION_ID && !hidden.has(p.id))
      .map(async p => {
        if (p.storage_provider === 'r2' && p.r2_object_key) {
          const url = await getSignedUrl(r2, new GetObjectCommand({
            Bucket: R2_BUCKET_NAME, Key: p.r2_object_key,
          }), { expiresIn: 3600 })
          return [p.id, url] as const
        }
        if (!p.image_path) return null
        const { data, error } = await db.storage.from('outing-photos')
          .createSignedUrl(p.image_path, 3600)
        if (error || !data?.signedUrl) return null
        return [p.id, data.signedUrl] as const
      }))
    return NextResponse.json({
      urls: Object.fromEntries(entries.filter((x): x is readonly [string, string] => x !== null)),
    }, { headers: NO_CACHE })
  } catch (error) {
    console.error('Slideshow photo URL error', error)
    return NextResponse.json({ error: '画像URLを取得できませんでした。' },
      { status: 500, headers: NO_CACHE })
  }
}
