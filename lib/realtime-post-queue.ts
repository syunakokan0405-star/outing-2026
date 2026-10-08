// Keep every unseen ID while hidden; resume without replacing the user's loaded feed.
export function createPostQueue(load: (ids: string[]) => Promise<void>, visible: () => boolean) {
  const ids = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let disposed = false
  async function flush() {
    if (disposed || running || !visible()) return
    running = true
    try {
      while (ids.size && !disposed && visible()) {
        const batch = [...ids].slice(0, 150)
        batch.forEach(id => ids.delete(id))
        try { await load(batch) }
        catch {
          batch.forEach(id => ids.add(id))
          // Keep IDs for the next notification/resume, without a rapid retry loop.
          break
        }
      }
    } finally { running = false }
  }
  return {
    enqueue(id: string) {
      if (disposed) return
      ids.add(id)
      if (timer) return
      timer = setTimeout(() => { timer = undefined; void flush() }, 150)
    },
    flush,
    dispose() { disposed = true; ids.clear(); if (timer) clearTimeout(timer) },
  }
}
