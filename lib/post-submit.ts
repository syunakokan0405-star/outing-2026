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

type R2UploadResult = {
  objectKey: string
  thumbnailKey: string
}

const THUMBNAIL_MAX_SIDE = 960
const THUMBNAIL_QUALITY = 0.82

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
        (error as { message?: string } | null)?.message ??
          error ??
          'Unknown error',
      )
}

async function createThumbnailBlob(
  sourceBlob: Blob,
): Promise<Blob> {
  const start = performance.now()
  const objectUrl = URL.createObjectURL(sourceBlob)

  try {
    const image = new Image()

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () =>
        reject(
          new Error(
            'Could not decode image for thumbnail.',
          ),
        )
      image.src = objectUrl
    })

    const sourceWidth = image.naturalWidth
    const sourceHeight = image.naturalHeight

    if (!sourceWidth || !sourceHeight) {
      throw new Error(
        'Invalid image dimensions for thumbnail.',
      )
    }

    const scale = Math.min(
      1,
      THUMBNAIL_MAX_SIDE /
        Math.max(sourceWidth, sourceHeight),
    )

    const width = Math.max(
      1,
      Math.round(sourceWidth * scale),
    )

    const height = Math.max(
      1,
      Math.round(sourceHeight * scale),
    )

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')

    if (!ctx) {
      throw new Error(
        'Could not create thumbnail canvas.',
      )
    }

    ctx.drawImage(image, 0, 0, width, height)

    const thumbnailBlob =
      await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob)
            } else {
              reject(
                new Error(
                  'Could not create thumbnail.',
                ),
              )
            }
          },
          'image/webp',
          THUMBNAIL_QUALITY,
        )
      })

    console.log(
      `[POST SPEED] サムネ生成: ${Math.round(
        performance.now() - start,
      )}ms / ${Math.round(
        thumbnailBlob.size / 1024,
      )}KB`,
    )

    return thumbnailBlob
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

async function uploadToR2(
  post: QueuedPost,
): Promise<R2UploadResult> {
  const totalStart = performance.now()

  // サムネイルはIndexedDBへ二重保存せず、
  // 保存済みの投稿画像から送信時に生成する。
  // そのため古い未送信投稿の再送にも対応できる。
  const thumbnailBlob =
    await createThumbnailBlob(post.imageBlob)

  const signStart = performance.now()

  const response = await fetch('/api/r2/upload-url', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      eventId: post.eventId,
      participantId: post.participantId,
      clientRequestId: post.clientRequestId,
    }),
  })

  console.log(
    `[POST SPEED] R2署名URL: ${Math.round(
      performance.now() - signStart,
    )}ms`,
  )

  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({
        error: 'Could not create upload URL.',
      }))

    throw new Error(
      body?.error ??
        `Could not create upload URL (${response.status})`,
    )
  }

  const data = (await response.json()) as {
    uploadUrl?: string
    key?: string
    thumbnailUploadUrl?: string
    thumbnailKey?: string
  }

  if (
    !data.uploadUrl ||
    !data.key ||
    !data.thumbnailUploadUrl ||
    !data.thumbnailKey
  ) {
    throw new Error('Invalid R2 upload response.')
  }

  const uploadStart = performance.now()

  // 本体とサムネイルを並列アップロード。
  // clientRequestId固定なので再送時も同じR2キーになる。
  const [mainResponse, thumbnailResponse] =
    await Promise.all([
      fetch(data.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'image/webp',
        },
        body: post.imageBlob,
      }),
      fetch(data.thumbnailUploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'image/webp',
        },
        body: thumbnailBlob,
      }),
    ])

  console.log(
    `[POST SPEED] R2写真+サムネPUT: ${Math.round(
      performance.now() - uploadStart,
    )}ms`,
  )

  if (!mainResponse.ok) {
    const errorText = await mainResponse
      .text()
      .catch(() => '')

    throw new Error(
      `R2 main upload failed (${mainResponse.status}): ${
        errorText || mainResponse.statusText
      }`,
    )
  }

  if (!thumbnailResponse.ok) {
    const errorText = await thumbnailResponse
      .text()
      .catch(() => '')

    throw new Error(
      `R2 thumbnail upload failed (${thumbnailResponse.status}): ${
        errorText || thumbnailResponse.statusText
      }`,
    )
  }

  console.log(
    `[POST SPEED] R2合計: ${Math.round(
      performance.now() - totalStart,
    )}ms`,
  )

  return {
    objectKey: data.key,
    thumbnailKey: data.thumbnailKey,
  }
}

async function sendQueuedPost(
  supabase: SupabaseClient,
  post: QueuedPost,
): Promise<string> {
  const sendStart = performance.now()

  const {
    objectKey: r2ObjectKey,
    thumbnailKey: r2ThumbnailKey,
  } = await uploadToR2(post)

  const rpcStart = performance.now()

  const { data, error: rpcError } =
    await supabase.rpc('submit_mission_post', {
      p_event_id: post.eventId,
      p_mission_id: post.missionId,
      p_image_path: r2ObjectKey,
      p_client_request_id: post.clientRequestId,
      p_comment: post.comment,
      p_visibility: post.visibility,
      p_mention_ids: post.mentionIds,
      p_storage_provider: 'r2',
      p_r2_object_key: r2ObjectKey,
      p_r2_thumbnail_key: r2ThumbnailKey,
    })

  console.log(
    `[POST SPEED] Supabase RPC: ${Math.round(
      performance.now() - rpcStart,
    )}ms`,
  )

  if (rpcError) {
    // RPCレスポンスが通信途中で失われても、
    // clientRequestIdの冪等性と固定R2キーで安全に再送できる。
    throw rpcError
  }

  console.log(
    `[POST SPEED] R2 + RPC合計: ${Math.round(
      performance.now() - sendStart,
    )}ms`,
  )

  return String(data)
}

export async function submitPostReliably(
  supabase: SupabaseClient,
  input: SubmitPostInput,
): Promise<SubmitPostResult> {
  const totalStart = performance.now()

  const queuedPost: QueuedPost = {
    ...input,
    createdAt: Date.now(),
    attempts: 0,
    status: 'pending',
    lastError: null,
  }

  const indexedDbStart = performance.now()

  await putPendingPost(queuedPost)

  console.log(
    `[POST SPEED] IndexedDB保存: ${Math.round(
      performance.now() - indexedDbStart,
    )}ms`,
  )

  try {
    const postId = await sendQueuedPost(
      supabase,
      queuedPost,
    )

    const removeStart = performance.now()

    await removePendingPost(
      queuedPost.clientRequestId,
    )

    console.log(
      `[POST SPEED] IndexedDB削除: ${Math.round(
        performance.now() - removeStart,
      )}ms`,
    )

    console.log(
      `[POST SPEED] ★ 投稿処理全体: ${Math.round(
        performance.now() - totalStart,
      )}ms`,
    )

    return {
      postId,
      queued: false,
      clientRequestId:
        queuedPost.clientRequestId,
    }
  } catch (error) {
    console.error(
      '[POST SPEED] 投稿エラー:',
      error,
    )

    if (looksLikeNetworkError(error)) {
      await putPendingPost({
        ...queuedPost,
        status: 'pending',
        lastError: errorMessage(error),
      })

      console.log(
        `[POST SPEED] キュー保存まで: ${Math.round(
          performance.now() - totalStart,
        )}ms`,
      )

      return {
        postId: null,
        queued: true,
        clientRequestId:
          queuedPost.clientRequestId,
      }
    }

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
    attempts: post.attempts + 1,
  }

  try {
    const postId = await sendQueuedPost(
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
    if (!looksLikeNetworkError(error)) {
      await putPendingPost({
        ...next,
        status: 'failed',
        lastError: errorMessage(error),
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
      lastError: errorMessage(error),
    })

    return {
      ok: false as const,
      permanent: false as const,
      error,
    }
  }
}