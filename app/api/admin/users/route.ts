import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'ログインが必要です。' },
        { status: 401 }
      )
    }

    const eventId = process.env.NEXT_PUBLIC_EVENT_ID

    if (!eventId) {
      return NextResponse.json(
        { error: 'EVENT IDが設定されていません。' },
        { status: 500 }
      )
    }

    const { data: currentAdmin, error: adminError } =
      await supabase
        .from('admin_users')
        .select('id,role')
        .eq('event_id', eventId)
        .eq('auth_user_id', user.id)
        .maybeSingle()

    if (
      adminError ||
      !currentAdmin ||
      !['owner', 'admin'].includes(currentAdmin.role)
    ) {
      return NextResponse.json(
        { error: '管理者作成権限がありません。' },
        { status: 403 }
      )
    }

    const body = await request.json()

    const email = String(body.email ?? '')
      .trim()
      .toLowerCase()

    const password = String(body.password ?? '')
    const displayName = String(body.displayName ?? '').trim()

    const role =
      body.role === 'admin' || body.role === 'staff'
        ? body.role
        : 'staff'

    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { error: '有効なメールアドレスを入力してください。' },
        { status: 400 }
      )
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'パスワードは8文字以上にしてください。' },
        { status: 400 }
      )
    }

    if (!displayName) {
      return NextResponse.json(
        { error: '表示名を入力してください。' },
        { status: 400 }
      )
    }

    const adminClient = createAdminClient()

    const {
      data: created,
      error: createAuthError,
    } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (createAuthError || !created.user) {
      return NextResponse.json(
        {
          error:
            createAuthError?.message ??
            '管理者アカウントを作成できませんでした。',
        },
        { status: 400 }
      )
    }

    const authUserId = created.user.id

    const { error: insertError } = await adminClient
      .from('admin_users')
      .insert({
        event_id: eventId,
        auth_user_id: authUserId,
        display_name: displayName,
        role,
        can_manage_missions:
          Boolean(body.canManageMissions),
        can_manage_stream:
          Boolean(body.canManageStream),
        can_manage_photos:
          Boolean(body.canManagePhotos),
        can_manage_awards:
          Boolean(body.canManageAwards),
        can_manage_guide:
          Boolean(body.canManageGuide),
        can_manage_participants:
          Boolean(body.canManageParticipants),
      })

    if (insertError) {
      await adminClient.auth.admin
        .deleteUser(authUserId)
        .catch(() => undefined)

      return NextResponse.json(
        { error: insertError.message },
        { status: 400 }
      )
    }

    return NextResponse.json({
      ok: true,
      userId: authUserId,
    })
  } catch (error) {
    console.error(error)

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : '管理者作成に失敗しました。',
      },
      { status: 500 }
    )
  }
}