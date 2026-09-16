import { NextResponse } from 'next/server'
import {
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'

import { createClient } from '@/lib/supabase/server'
import { r2, R2_BUCKET_NAME } from '@/lib/r2'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Unauthorized.',
        },
        { status: 401 },
      )
    }

    const key =
      `diagnostics/${user.id}/${crypto.randomUUID()}.txt`

    // R2へ直接テストファイルを書き込む
    await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: 'outing-r2-health-check',
        ContentType: 'text/plain',
      }),
    )

    // 書き込み成功後、テストファイルを削除
    await r2.send(
      new DeleteObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
      }),
    )

    return NextResponse.json({
      ok: true,
    })
  } catch (error) {
    console.error('R2 health check failed:', error)

    const err = error as {
      name?: string
      message?: string
      $metadata?: {
        httpStatusCode?: number
      }
    }

    return NextResponse.json(
      {
        ok: false,
        name: err?.name ?? 'Error',
        error:
          err?.message ??
          'R2 health check failed.',
        status:
          err?.$metadata?.httpStatusCode ??
          null,
      },
      { status: 500 },
    )
  }
}