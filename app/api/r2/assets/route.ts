import { NextResponse } from 'next/server'
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { r2, R2_BUCKET_NAME } from '@/lib/r2'
import { isBackgroundPath } from '@/lib/background-assets'

export const runtime = 'nodejs'
const copying = new Map<string, Promise<void>>()
const types: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' }

async function identity() {
  const db = await createClient()
  const { data: { user }, error } = await db.auth.getUser()
  const eventId = process.env.NEXT_PUBLIC_EVENT_ID
  if (error || !user || !eventId) return null
  return { db, user, eventId }
}

// Legacy backgrounds are copied only on the first uncached read. Source objects
// remain intact, so deployments can be rolled back without losing any images.
async function ensureLegacy(path: string, key: string, source: Awaited<ReturnType<typeof createClient>>) {
  try { await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key })); return }
  catch (error: any) { if (error.$metadata?.httpStatusCode !== 404) throw error }
  let pending = copying.get(key)
  if (!pending) {
    pending = (async () => {
      const { data, error } = await source.storage.from('outing-photos').download(path)
      if (error || !data) throw error || new Error('Source image unavailable')
      if (data.size > 12 * 1024 * 1024 || !types[data.type]) throw new Error('Unsupported background image')
      await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key, Body: new Uint8Array(await data.arrayBuffer()), ContentType: data.type, CacheControl: 'public, max-age=31536000, immutable' }))
    })()
    copying.set(key, pending)
  }
  try { await pending } finally { if (copying.get(key) === pending) copying.delete(key) }
}

export async function GET(request: Request) {
  try {
    const context = await identity()
    if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { db, user, eventId } = context
    const path = new URL(request.url).searchParams.get('path') || ''
    if (!isBackgroundPath(path, eventId)) return NextResponse.json({ error: 'Invalid background path' }, { status: 400 })
    const [participant, admin] = await Promise.all([
      db.from('participants').select('id').eq('event_id', eventId).eq('auth_user_id', user.id).eq('is_active', true).maybeSingle(),
      db.from('admin_users').select('id').eq('event_id', eventId).eq('auth_user_id', user.id).maybeSingle(),
    ])
    if (!participant.data && !admin.data) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const key = path.startsWith('r2:') ? path.slice(3) : `assets/${eventId}/legacy/${path}`
    if (!path.startsWith('r2:')) await ensureLegacy(path, key, db)
    const object = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }))
    if (!object.Body) throw new Error('Empty image')
    return new Response(object.Body.transformToWebStream() as ReadableStream, {
      headers: { 'Content-Type': object.ContentType || 'application/octet-stream', 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
    })
  } catch (error) {
    console.error('Background read failed', error)
    return NextResponse.json({ error: 'Could not load background' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const context = await identity()
    if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { db, user, eventId } = context
    const body = await request.json()
    const kind = body.kind
    if (body.action !== 'migrate' && kind !== 'home' && kind !== 'mission' && kind !== 'stream') return NextResponse.json({ error: 'Invalid background kind' }, { status: 400 })
    const { data: admin } = await db.from('admin_users').select('role,can_manage_missions,can_manage_guide,can_manage_stream').eq('event_id', eventId).eq('auth_user_id', user.id).maybeSingle()
    if (!admin || (!['owner', 'admin'].includes(admin.role) && !(kind === 'mission' ? admin.can_manage_missions : kind === 'stream' ? admin.can_manage_stream : admin.can_manage_guide))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (body.action === 'migrate') {
      if (!['owner', 'admin'].includes(admin.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      const service = createAdminClient()
      const [event, missions] = await Promise.all([
        service.from('events').select('ranking_background_path,announcement_background_path,guide_background_path').eq('id', eventId).single(),
        service.from('missions').select('id,image_path,mission_drops!inner(event_id)').eq('mission_drops.event_id', eventId).not('image_path', 'is', null),
      ])
      if (event.error || missions.error) throw event.error || missions.error
      const tasks: { table: string; id: string; column: string; path: string }[] = []
      for (const [column, value] of Object.entries(event.data || {})) {
        if (typeof value === 'string' && !value.startsWith('r2:') && isBackgroundPath(value, eventId)) tasks.push({ table: 'events', id: eventId, column, path: value })
      }
      for (const mission of missions.data || []) {
        if (mission.image_path && !mission.image_path.startsWith('r2:') && isBackgroundPath(mission.image_path, eventId)) tasks.push({ table: 'missions', id: mission.id, column: 'image_path', path: mission.image_path })
      }
      // Bounded batches keep the migration below serverless request limits.
      const batch = tasks.slice(0, 3)
      for (const task of batch) {
        const key = `assets/${eventId}/legacy/${task.path}`
        await ensureLegacy(task.path, key, service)
        const { error } = await service.from(task.table).update({ [task.column]: `r2:${key}` }).eq('id', task.id).eq(task.column, task.path)
        if (error) throw error
      }
      return NextResponse.json({ migrated: batch.length, remaining: tasks.length - batch.length })
    }
    const extension = types[body.contentType]
    if (!extension) return NextResponse.json({ error: 'Unsupported image type' }, { status: 400 })
    const key = `assets/${eventId}/${kind}/${crypto.randomUUID()}.${extension}`
    const uploadUrl = await getSignedUrl(r2, new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key, ContentType: body.contentType }), { expiresIn: 300 })
    return NextResponse.json({ path: `r2:${key}`, uploadUrl })
  } catch (error) {
    console.error('Background upload failed', error)
    return NextResponse.json({ error: 'Could not create upload URL' }, { status: 500 })
  }
}
