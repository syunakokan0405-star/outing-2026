import { NextResponse } from 'next/server'
import {
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3'

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

    // 削除前に投稿情報を取得
    const { data: post, error: postError } =
      await supabase
        .from('posts')
        .select(`
          id,
          event_id,
          participant_id,
          storage_provider,
          r2_object_key,
          r2_thumbnail_key,
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

    // 投稿者本人か確認
    const { data: participant } =
      await supabase
        .from('participants')
        .select('id')
        .eq('id', post.participant_id)
        .eq('auth_user_id', user.id)
        .eq('is_active', true)
        .maybeSingle()

    const isOwner = Boolean(participant)

    // Adminか確認
    const { data: admin } =
      await supabase
        .from('admin_users')
        .select(`
          id,
          role,
          can_manage_photos
        `)
        .eq('event_id', post.event_id)
        .eq('auth_user_id', user.id)
        .maybeSingle()

    const isAdmin =
      Boolean(admin) &&
      (
        admin?.role === 'owner' ||
        admin?.role === 'admin' ||
        admin?.can_manage_photos === true
      )

    if (!isOwner && !isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden.' },
        { status: 403 },
      )
    }

    // DBをsoft delete
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

    // R2なら元画像 + サムネイルを両方削除
    if (post.storage_provider === 'r2') {
      const keys = [
        post.r2_object_key,
        post.r2_thumbnail_key,
      ].filter(
        (key): key is string =>
          typeof key === 'string' &&
          key.length > 0,
      )

      if (keys.length > 0) {
        await r2.send(
          new DeleteObjectsCommand({
            Bucket: R2_BUCKET_NAME,
            Delete: {
              Objects: keys.map((Key) => ({
                Key,
              })),
              Quiet: true,
            },
          }),
        )
      }
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