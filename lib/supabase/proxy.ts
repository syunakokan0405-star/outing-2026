import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
          Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value))
        },
      },
    },
  )

  // Admin pages and exports remain available after the event closes.
  const path = request.nextUrl.pathname
  if (!path.startsWith('/admin') && !path.startsWith('/api/admin/') && path !== '/closed') {
    const { data: event, error } = await supabase.from('events').select('status')
      .eq('id', process.env.NEXT_PUBLIC_EVENT_ID!).single()
    if (!error && event?.status === 'archive') {
      const stopped = path.startsWith('/api/')
        ? NextResponse.json({ error: 'Outing 2026は終了しました。' }, { status: 410 })
        : NextResponse.redirect(new URL('/closed', request.url))
      response.cookies.getAll().forEach(cookie => stopped.cookies.set(cookie))
      return stopped
    }
  }
  await supabase.auth.getClaims()
  return response
}
