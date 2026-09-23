import { NextResponse } from 'next/server'
import { GetObjectCommand } from '@aws-sdk/client-s3'
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

    const participantIds = Array.isArray(body.participantIds)
      ? [
          ...new Set(
            body.participantIds
              .map((id: unknown) => String(id))
              .filter(Boolean),
          ),
        ]
      : []

    if (!participantIds.length) {
      return NextResponse.json({ urls: {} })
    }

    if (participantIds.length > 150) {
      return NextResponse.json(
        { error: 'Too many participant IDs.' },
        { status: 400 },
      )
    }

    const { data: participants, error: participantsError } =
      await supabase
        .from('participants')
        .select('id,avatar_path')
        .in('id', participantIds)
        .eq('is_active', true)

    if (participantsError) {
      console.error(
        'R2 avatar lookup error:',
        participantsError,
      )

      return NextResponse.json(
        { error: 'Could not load avatars.' },
        { status: 500 },
      )
    }

    const entries = await Promise.all(
      (participants ?? [])
        .filter(
          (participant) =>
            typeof participant.avatar_path === 'string' &&
            participant.avatar_path.startsWith('avatars/'),
        )
        .map(async (participant) => {
          const command = new GetObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: participant.avatar_path,
          })

          const signedUrl = await getSignedUrl(
            r2,
            command,
            {
              expiresIn: 60 * 60,
            },
          )

          return [
            participant.id,
            signedUrl,
          ] as const
        }),
    )

    return NextResponse.json({
      urls: Object.fromEntries(entries),
    })
  } catch (error) {
    console.error(
      'R2 avatar read URL error:',
      error,
    )

    return NextResponse.json(
      {
        error:
          'Could not create avatar URLs.',
      },
      { status: 500 },
    )
  }
}