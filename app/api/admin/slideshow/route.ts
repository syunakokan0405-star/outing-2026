import { NextResponse } from 'next/server'
import { getCurrentAdmin, getEventId } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TEST_MISSION_ID = '9d463703-db42-4fa1-b36a-737931c3fb5b'
const NO_CACHE = { 'Cache-Control': 'private, no-store' }

async function authorized() {
  const admin = await getCurrentAdmin()
  if (!admin || (!['owner', 'admin'].includes(admin.role) && !admin.can_manage_photos)) return null
  return admin
}

export async function GET() {
  try {
    const admin = await authorized()
    if (!admin) return NextResponse.json({ error: '写真管理権限が必要です。' }, { status: 403, headers: NO_CACHE })
    const eventId = getEventId()
    const db = createAdminClient()
    const rows: Array<{
      id: string; created_at: string; mission_id: string | null;
      participants: { name: string } | null; missions: { title: string } | null
    }> = []
    // Paged metadata only: never transfer image bytes while polling.
    for (let offset = 0; offset < 3000; offset += 500) {
      const { data, error } = await db.from('posts')
        .select('id,created_at,mission_id,participants!posts_participant_id_fkey(name),missions(title)')
        .eq('event_id', eventId)
        .eq('visibility', 'stream')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range(offset, offset + 499)
      if (error) throw error
      const batch = (data ?? []) as unknown as typeof rows
      rows.push(...batch)
      if (batch.length < 500) break
    }
    const { data: hidden, error: hiddenError } = await db.from('slideshow_hidden_posts')
      .select('post_id').eq('event_id', eventId)
    if (hiddenError) throw hiddenError
    const hiddenIds = new Set((hidden ?? []).map(row => row.post_id))
    const posts = rows
      .filter(p => p.mission_id !== TEST_MISSION_ID)
      .map(p => ({
        id: p.id,
        createdAt: p.created_at,
        participant: p.participants?.name ?? '参加者',
        mission: p.missions?.title ?? '',
        hidden: hiddenIds.has(p.id),
        hearts: 0,
      }))
    // Reuse the existing server-ranked Liked top 15; no expensive per-post reaction transfer.
    const { createClient } = await import('@/lib/supabase/server')
    const client = await createClient()
    const { data: liked } = await client.rpc('get_liked_stream', { p_event_id: eventId })
    const heartCounts = new Map((liked ?? []).map((r: { post_id: string; heart_count: number }) =>
      [r.post_id, Number(r.heart_count)]))
    for (const p of posts) p.hearts = heartCounts.get(p.id) ?? 0
    return NextResponse.json({ posts, fetchedAt: new Date().toISOString(), truncated: rows.length >= 3000 },
      { headers: NO_CACHE })
  } catch (error) {
    console.error('Slideshow manifest error', error)
    return NextResponse.json({ error: '上映用投稿を取得できませんでした。' },
      { status: 500, headers: NO_CACHE })
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await authorized()
    if (!admin) return NextResponse.json({ error: '写真管理権限が必要です。' }, { status: 403, headers: NO_CACHE })
    const body = await request.json().catch(() => null)
    const postId = body?.postId
    if (typeof postId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(postId) ||
        typeof body?.hidden !== 'boolean') {
      return NextResponse.json({ error: '投稿IDと表示設定を確認してください。' }, { status: 400, headers: NO_CACHE })
    }
    const eventId = getEventId()
    const db = createAdminClient()
    const { data: post, error: checkError } = await db.from('posts')
      .select('id,mission_id').eq('event_id', eventId).eq('id', postId)
      .eq('visibility', 'stream').is('deleted_at', null).maybeSingle()
    if (checkError) throw checkError
    if (!post || post.mission_id === TEST_MISSION_ID) {
      return NextResponse.json({ error: 'この投稿は上映対象ではありません。' }, { status: 404, headers: NO_CACHE })
    }
    const result = body.hidden
      ? await db.from('slideshow_hidden_posts')
          .upsert({ event_id: eventId, post_id: postId, hidden_by: admin.id }, { onConflict: 'event_id,post_id' })
      : await db.from('slideshow_hidden_posts')
          .delete().eq('event_id', eventId).eq('post_id', postId)
    if (result.error) throw result.error
    return NextResponse.json({ ok: true, postId, hidden: body.hidden }, { headers: NO_CACHE })
  } catch (error) {
    console.error('Slideshow exclusion update error', error)
    return NextResponse.json({ error: '上映設定を保存できませんでした。' }, { status: 500, headers: NO_CACHE })
  }
}
