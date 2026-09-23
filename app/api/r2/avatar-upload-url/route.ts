import { NextResponse } from 'next/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { createClient } from '@/lib/supabase/server'
import { r2, R2_BUCKET_NAME } from '@/lib/r2'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized.' },
        { status: 401 },
      )
    }

    const body = await request.json()

    const eventId = String(body.eventId ?? '')
    const participantId = String(body.participantId ?? '')

    if (!eventId || !participantId) {
      return NextResponse.json(
        { error: 'Missing upload information.' },
        { status: 400 },
      )
    }

    // ログイン中ユーザー本人のparticipantか確認
    const { data: participant, error: participantError } =
      await supabase
        .from('participants')
        .select('id,event_id')
        .eq('id', participantId)
        .eq('event_id', eventId)
        .eq('auth_user_id', user.id)
        .eq('is_active', true)
        .maybeSingle()

    if (participantError || !participant) {
      return NextResponse.json(
        { error: 'Participant verification failed.' },
        { status: 403 },
      )
    }

    // avatarは参加者ごとに固定キー
    const key =
      `avatars/${participantId}/avatar.webp`

    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      ContentType: 'image/webp',
    })

    const uploadUrl = await getSignedUrl(
      r2,
      command,
      {
        expiresIn: 300,
      },
    )

    return NextResponse.json({
      uploadUrl,
      key,
    })
  } catch (error) {
    console.error(
      'R2 avatar upload URL error:',
      error,
    )

    return NextResponse.json(
      {
        error:
          'Could not create avatar upload URL.',
      },
      { status: 500 },
    )
  }
}