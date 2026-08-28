import type { SupabaseClient } from '@supabase/supabase-js'
import { putPendingPost, removePendingPost, type QueuedPost } from '@/lib/offline-post-queue'

export type SubmitPostInput = Omit<QueuedPost, 'createdAt' | 'attempts' | 'status' | 'lastError'>

export type SubmitPostResult = {
  postId: string | null
  queued: boolean
  clientRequestId: string
}

function looksLikeDuplicateStorageError(error: { message?: string; statusCode?: string | number } | null) {
  if (!error) return false
  const status = String(error.statusCode ?? '')
  return status === '409' || /duplicate|already exists|resource already exists/i.test(error.message ?? '')
}

function looksLikeNetworkError(error: unknown) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /failed to fetch|network|load failed|fetch failed|connection|timeout|timed out|503|502|504/i.test(message)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? error ?? 'Unknown error')
}

async function sendQueuedPost(supabase: SupabaseClient, post: QueuedPost): Promise<string> {
  let uploadedNow = false
  const { error: uploadError } = await supabase.storage
    .from('outing-photos')
    .upload(post.imagePath, post.imageBlob, {
      contentType: 'image/webp',
      cacheControl: '3600',
      upsert: false,
    })

  if (!uploadError) uploadedNow = true
  else if (!looksLikeDuplicateStorageError(uploadError)) throw uploadError

  const { data, error: rpcError } = await supabase.rpc('submit_mission_post_optional_mentions', {
    p_event_id: post.eventId,
    p_mission_id: post.missionId,
    p_image_path: post.imagePath,
    p_comment: post.comment,
    p_visibility: post.visibility,
    p_mention_ids: post.mentionIds,
    p_client_request_id: post.clientRequestId,
  })

  if (rpcError) {
    // If this attempt definitely uploaded a new object and the DB rejected the post
    // for a permanent reason, remove the orphaned object. On network errors we keep it
    // because a retry can safely reuse the same path/request id.
    if (uploadedNow && !looksLikeNetworkError(rpcError)) {
      await supabase.storage.from('outing-photos').remove([post.imagePath]).catch(() => undefined)
    }
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

  // Persist before network I/O so closing the browser or losing signal does not lose the photo.
  await putPendingPost(queuedPost)

  try {
    const postId = await sendQueuedPost(supabase, queuedPost)
    await removePendingPost(queuedPost.clientRequestId)
    return { postId, queued: false, clientRequestId: queuedPost.clientRequestId }
  } catch (error) {
    if (looksLikeNetworkError(error)) {
      await putPendingPost({ ...queuedPost, status: 'pending', lastError: errorMessage(error) })
      return { postId: null, queued: true, clientRequestId: queuedPost.clientRequestId }
    }

    // Immediate permanent errors are shown on the active posting screen, so remove the queue item.
    await removePendingPost(queuedPost.clientRequestId)
    throw error
  }
}

export async function retryQueuedPost(supabase: SupabaseClient, post: QueuedPost) {
  if (post.status === 'failed') {
    return { ok: false as const, permanent: true as const, error: new Error(post.lastError ?? '再送できません') }
  }

  const next = { ...post, attempts: post.attempts + 1 }
  try {
    const postId = await sendQueuedPost(supabase, next)
    await removePendingPost(post.clientRequestId)
    return { ok: true as const, postId }
  } catch (error) {
    if (!looksLikeNetworkError(error)) {
      // Do not silently discard an offline post when the later retry becomes invalid
      // (for example Archive Mode or expired auth). Keep it visible for the participant.
      await putPendingPost({ ...next, status: 'failed', lastError: errorMessage(error) })
      return { ok: false as const, permanent: true as const, error }
    }
    await putPendingPost({ ...next, status: 'pending', lastError: errorMessage(error) })
    return { ok: false as const, permanent: false as const, error }
  }
}
