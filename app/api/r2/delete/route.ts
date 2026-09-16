import { NextResponse } from 'next/server'
import { DeleteObjectCommand } from '@aws-sdk/client-s3'

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
    const postId = String(body.postId ?? '')

    if (!postId) {
      return NextResponse.json(
        { error: 'Missing post ID.' },
        { status: 400 },
      )
    }

    // ① 削除前に投稿情報を取得しておく
    const { data: post, error: postError } =
      await supabase
        .from('posts')
        .select(`
          id,
          participant_id,
          storage_provider,
          r2_object_key,
          image_path,
          deleted_at
        `)
        .eq('id', postId)
        .maybeSingle()

    if (postError || !post) {
      return NextResponse.json(
        { error: 'Post not found.' },
        { status: 404 },
      )
    }

    // ② 本人の投稿か確認
    const { data: participant, error: participantError } =
      await supabase
        .from('participants')
        .select('id')
        .eq('id', post.participant_id)
        .eq('auth_user_id', user.id)
        .eq('is_active', true)
        .maybeSingle()

    if (participantError || !participant) {
      return NextResponse.json(
        { error: 'Forbidden.' },
        { status: 403 },
      )
    }

    // ③ DBをsoft delete
    if (!post.deleted_at) {
      const { error: deleteError } =
        await supabase.rpc('delete_post', {
          p_post_id: postId,
        })

      if (deleteError) {
        console.error(
          'delete_post RPC error:',
          deleteError,
        )

        return NextResponse.json(
          { error: deleteError.message },
          { status: 500 },
        )
      }
    }

    // ④ R2投稿なら実ファイルも削除
    if (
      post.storage_provider === 'r2' &&
      post.r2_object_key
    ) {
      await r2.send(
        new DeleteObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: post.r2_object_key,
        }),
      )
    }

    return NextResponse.json({
      success: true,
      storageDeleted:
        post.storage_provider === 'r2',
    })
  } catch (error) {
    console.error('Post delete error:', error)

    return NextResponse.json(
      { error: 'Could not delete post.' },
      { status: 500 },
    )
  }
}