'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { listPendingPosts, removePendingPost } from '@/lib/offline-post-queue'
import { retryQueuedPost } from '@/lib/post-submit'

export default function PendingPostSync() {
  const supabase = useMemo(() => createClient(), [])
  const [pending, setPending] = useState(0)
  const [failed, setFailed] = useState(0)
  const [syncing, setSyncing] = useState(false)

  const refreshCount = useCallback(async () => {
    try {
      const rows = await listPendingPosts()
      setPending(rows.filter((p) => p.status !== 'failed').length)
      setFailed(rows.filter((p) => p.status === 'failed').length)
    } catch {
      setPending(0)
      setFailed(0)
    }
  }, [])

  const sync = useCallback(async () => {
    if (syncing || typeof navigator === 'undefined' || !navigator.onLine) return
    setSyncing(true)
    try {
      const posts = await listPendingPosts()
      for (const post of posts.filter((p) => p.status !== 'failed')) {
        await retryQueuedPost(supabase, post)
      }
      await refreshCount()
    } finally {
      setSyncing(false)
    }
  }, [refreshCount, supabase, syncing])

  const clearFailed = useCallback(async () => {
    const posts = await listPendingPosts()
    for (const post of posts.filter((p) => p.status === 'failed')) {
      await removePendingPost(post.clientRequestId)
    }
    await refreshCount()
  }, [refreshCount])

  useEffect(() => {
    void refreshCount().then(() => sync())
    const online = () => void sync()
    window.addEventListener('online', online)
    const interval = window.setInterval(() => void sync(), 30_000)
    return () => {
      window.removeEventListener('online', online)
      window.clearInterval(interval)
    }
  }, [refreshCount, sync])

  if (pending === 0 && failed === 0) return null

  return <aside className="pendingSync" role="status" aria-live="polite">
    {failed > 0 ? <>
      <span>再送できない写真 {failed}件。イベント状態やログインを確認してください。</span>
      <button type="button" onClick={() => void clearFailed()}>端末から破棄</button>
    </> : <>
      <span>{syncing ? '未送信の写真を再送中…' : `未送信の写真 ${pending}件`}</span>
      {!syncing && <button type="button" onClick={() => void sync()}>再送</button>}
    </>}
  </aside>
}
