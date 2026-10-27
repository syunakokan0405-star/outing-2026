import { NextResponse } from 'next/server'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getCurrentAdmin, getEventId } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { r2, R2_BUCKET_NAME } from '@/lib/r2'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }

export async function GET(request: Request) {
  try {
    const admin = await getCurrentAdmin()
    if (!admin || (!['owner', 'admin'].includes(admin.role) && !admin.can_manage_photos)) {
      return NextResponse.json({ error: '写真管理権限が必要です。' }, { status: 403, headers })
    }
    const db = createAdminClient()
    const eventId = getEventId()
    const query = new URL(request.url).searchParams
    const id = query.get('id')
    const kind = query.get('kind') === 'staff' ? 'staff' : 'participant'
    if (id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response(null, { status: 400, headers })
      const table = kind === 'staff' ? 'stream_posts' : 'posts'
      const { data: post, error } = await db.from(table)
        .select(kind === 'staff' ? 'image_path' : 'image_path,storage_provider,r2_object_key')
        .eq('event_id', eventId).eq('id', id).is('deleted_at', null).single()
      if (error || !post) return new Response(null, { status: 404, headers })
      const row = post as unknown as { image_path: string | null; storage_provider?: string; r2_object_key?: string }
      const key = row.storage_provider === 'r2' ? row.r2_object_key : row.image_path?.startsWith('r2:') ? row.image_path.slice(3) : null
      if (key) {
        const object = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }))
        if (!object.Body) throw new Error('Missing image')
        return new Response(await object.Body.transformToByteArray() as BodyInit, {
          headers: { ...headers, 'Content-Type': object.ContentType || 'application/octet-stream' },
        })
      }
      if (!row.image_path) return new Response(null, { status: 404, headers })
      const { data, error: downloadError } = await db.storage.from('outing-photos').download(row.image_path)
      if (downloadError || !data) throw downloadError || new Error('Missing image')
      return new Response(data, { headers: { ...headers, 'Content-Type': data.type || 'application/octet-stream' } })
    }
    const posts: unknown[] = []
    // No slideshow filters or page limits: include test and gallery posts too.
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await db.from('posts')
        .select('id,participant_id,mission_id,comment,visibility,created_at,participants!posts_participant_id_fkey(name),missions(title)')
        .eq('event_id', eventId).is('deleted_at', null).order('id').range(offset, offset + 499)
      if (error) throw error
      posts.push(...(data ?? []).map(p => ({ ...p, kind: 'participant', hasImage: true })))
      if (!data || data.length < 500) break
    }
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await db.from('stream_posts').select('id,title,body,created_at,image_path')
        .eq('event_id', eventId).is('deleted_at', null).order('id').range(offset, offset + 499)
      if (error) throw error
      posts.push(...(data ?? []).map(({ image_path, ...p }) => ({ ...p, kind: 'staff', hasImage: !!image_path })))
      if (!data || data.length < 500) break
    }
    return NextResponse.json({ exportedAt: new Date().toISOString(), posts }, { headers })
  } catch (error) {
    console.error('Photo export failed', error)
    return NextResponse.json({ error: '投稿を書き出せませんでした。再実行してください。' }, { status: 500, headers })
  }
}
