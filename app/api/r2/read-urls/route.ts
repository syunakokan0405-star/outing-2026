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

    const postIds = Array.isArray(body.postIds)
      ? [...new Set(
          body.postIds
            .map((id: unknown) => String(id))
            .filter(Boolean),
        )]
      : []

    if (!postIds.length) {
      return NextResponse.json({ urls: {} })
    }

    // Stream / Gallery の上限より少し余裕を持たせる
    if (postIds.length > 150) {
      return NextResponse.json(
        { error: 'Too many post IDs.' },
        { status: 400 },
      )
    }

    const { data: posts, error: postsError } =
      await supabase
        .from('posts')
        .select(
          'id,storage_provider,r2_object_key,deleted_at',
        )
        .in('id', postIds)
        .is('deleted_at', null)
        .eq('storage_provider', 'r2')

    if (postsError) {
      console.error(
        'R2 batch post lookup error:',
        postsError,
      )

      return NextResponse.json(
        { error: 'Could not load posts.' },
        { status: 500 },
      )
    }

    const entries = await Promise.all(
      (posts ?? [])
        .filter((post) => post.r2_object_key)
        .map(async (post) => {
          const command = new GetObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: post.r2_object_key,
          })

          const signedUrl = await getSignedUrl(
            r2,
            command,
            {
              expiresIn: 60 * 60,
            },
          )

          return [post.id, signedUrl] as const
        }),
    )

    return NextResponse.json({
      urls: Object.fromEntries(entries),
    })
  } catch (error) {
    console.error(
      'R2 batch read URL error:',
      error,
    )

    return NextResponse.json(
      { error: 'Could not create image URLs.' },
      { status: 500 },
    )
  }
}