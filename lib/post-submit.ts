import type { SupabaseClient } from '@supabase/supabase-js'
import {
  putPendingPost,
  removePendingPost,
  type QueuedPost,
} from '@/lib/offline-post-queue'

export type SubmitPostInput = Omit<
  QueuedPost,
  'createdAt' | 'attempts' | 'status' | 'lastError'
>

export type SubmitPostResult = {
  postId: string | null
  queued: boolean
  clientRequestId: string
}

function looksLikeNetworkError(error: unknown) {
  if (
    typeof navigator !== 'undefined' &&
    !navigator.onLine
  ) {
    return true
  }

  const message =
    error instanceof Error
      ? error.message
      : String(error ?? '')

  return /failed to fetch|network|load failed|fetch failed|connection|timeout|timed out|503|502|504/i.test(
    message,
  )
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : String(
        (error as { message?: string } | null)
          ?.message ??
          error ??
          'Unknown error',
      )
}

async function uploadToR2(
  post: QueuedPost,
): Promise<string> {
  const response = await fetch(
    '/api/r2/upload-url',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        eventId: post.eventId,
        participantId: post.participantId,
        clientRequestId:
          post.clientRequestId,
      }),
    },
  )

  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({
        error:
          'Could not create upload URL.',
      }))

    throw new Error(
      body?.error ??
        `Could not create upload URL (${response.status})`,
    )
  }

  const data = (await response.json()) as {
    uploadUrl?: string
    key?: string
  }

  if (!data.uploadUrl || !data.key) {
    throw new Error(
      'Invalid R2 upload response.',
    )
  }

  const uploadResponse = await fetch(
    data.uploadUrl,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'image/webp',
      },
      body: post.imageBlob,
    },
  )

  if (!uploadResponse.ok) {
    const errorText =
      await uploadResponse
        .text()
        .catch(() => '')

    throw new Error(
      `R2 upload failed (${uploadResponse.status}): ${
        errorText ||
        uploadResponse.statusText
      }`,
    )
  }

  return data.key
}

async function sendQueuedPost(
  supabase: SupabaseClient,
  post: QueuedPost,
): Promise<string> {
  // clientRequestIdから毎回同じR2 keyを使用するため、
  // 再送されても別ファイルは作られない。
  const r2ObjectKey =
    await uploadToR2(post)

  const { data, error: rpcError } =
    await supabase.rpc(
      'submit_mission_post',
      {
        p_event_id: post.eventId,
        p_mission_id: post.missionId,
        p_image_path: r2ObjectKey,
        p_client_request_id:
          post.clientRequestId,
        p_comment: post.comment,
        p_visibility:
          post.visibility,
        p_mention_ids:
          post.mentionIds,
        p_storage_provider: 'r2',
        p_r2_object_key:
          r2ObjectKey,
      },
    )

  if (rpcError) {
    /*
     * RPC失敗時もR2画像は即削除しない。
     *
     * DBへのレスポンスだけ通信切断した場合、
     * 実際には投稿作成済みの可能性がある。
     *
     * clientRequestIdによる冪等性と
     * 固定R2 keyによって安全に再送できる。
     */
    throw rpcError
  }

  return String(data)
}

export async function submitPostReliably(
  supabase: SupabaseClient,
  input: SubmitPostInput,
): Promise<SubmitPostResult> {
  const queuedPost: QueuedPost = {
    ...input,
    createdAt: Date.now(),
    attempts: 0,
    status: 'pending',
    lastError: null,
  }

  // 通信開始前にIndexedDBへ保存。
  // 通信断やブラウザ終了でも写真を失わない。
  await putPendingPost(queuedPost)

  try {
    const postId =
      await sendQueuedPost(
        supabase,
        queuedPost,
      )

    await removePendingPost(
      queuedPost.clientRequestId,
    )

    return {
      postId,
      queued: false,
      clientRequestId:
        queuedPost.clientRequestId,
    }
  } catch (error) {
    if (looksLikeNetworkError(error)) {
      await putPendingPost({
        ...queuedPost,
        status: 'pending',
        lastError:
          errorMessage(error),
      })

      return {
        postId: null,
        queued: true,
        clientRequestId:
          queuedPost.clientRequestId,
      }
    }

    // 権限エラー・Mission終了など、
    // 再送しても直らないエラーはキューから削除。
    await removePendingPost(
      queuedPost.clientRequestId,
    )

    throw error
  }
}

export async function retryQueuedPost(
  supabase: SupabaseClient,
  post: QueuedPost,
) {
  if (post.status === 'failed') {
    return {
      ok: false as const,
      permanent: true as const,
      error: new Error(
        post.lastError ??
          '再送できません',
      ),
    }
  }

  const next = {
    ...post,
    attempts:
      post.attempts + 1,
  }

  try {
    const postId =
      await sendQueuedPost(
        supabase,
        next,
      )

    await removePendingPost(
      post.clientRequestId,
    )

    return {
      ok: true as const,
      postId,
    }
  } catch (error) {
    if (
      !looksLikeNetworkError(error)
    ) {
      await putPendingPost({
        ...next,
        status: 'failed',
        lastError:
          errorMessage(error),
      })

      return {
        ok: false as const,
        permanent: true as const,
        error,
      }
    }

    await putPendingPost({
      ...next,
      status: 'pending',
      lastError:
        errorMessage(error),
    })

    return {
      ok: false as const,
      permanent: false as const,
      error,
    }
  }
}