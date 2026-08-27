export type QueuedPost = {
  clientRequestId: string
  eventId: string
  participantId: string
  missionId: string
  imagePath: string
  imageBlob: Blob
  comment: string | null
  visibility: 'stream' | 'gallery'
  mentionIds: string[]
  createdAt: number
  attempts: number
  status?: 'pending' | 'failed'
  lastError?: string | null
}

const DB_NAME = 'outing-2026-offline'
const DB_VERSION = 1
const STORE = 'pending-posts'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'clientRequestId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDBを開けませんでした'))
  })
}

export async function putPendingPost(post: QueuedPost) {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(post)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('未送信投稿を保存できませんでした'))
      tx.onabort = () => reject(tx.error ?? new Error('未送信投稿の保存が中断されました'))
    })
  } finally {
    db.close()
  }
}

export async function removePendingPost(clientRequestId: string) {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(clientRequestId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('未送信投稿を削除できませんでした'))
    })
  } finally {
    db.close()
  }
}

export async function listPendingPosts(): Promise<QueuedPost[]> {
  const db = await openDb()
  try {
    return await new Promise<QueuedPost[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const request = tx.objectStore(STORE).getAll()
      request.onsuccess = () => resolve((request.result ?? []) as QueuedPost[])
      request.onerror = () => reject(request.error ?? new Error('未送信投稿を読み込めませんでした'))
    })
  } finally {
    db.close()
  }
}

export async function updatePendingPost(post: QueuedPost) {
  return putPendingPost(post)
}

export async function countPendingPosts() {
  const db = await openDb()
  try {
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const request = tx.objectStore(STORE).count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('未送信件数を取得できませんでした'))
    })
  } finally {
    db.close()
  }
}
