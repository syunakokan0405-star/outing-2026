export type NotificationRow = {
  id: string
  title: string
  body: string | null
  href: string | null
  type: string
  is_read: boolean
  created_at: string
}
export function applyNotificationChange(rows: NotificationRow[], event: string, next: unknown, previous: unknown): NotificationRow[] | null {
  if (event === 'DELETE') {
    const id = (previous as {id?: unknown})?.id
    return typeof id === 'string' ? rows.filter(row => row.id !== id) : null
  }
  if (event !== 'INSERT' && event !== 'UPDATE') return null
  const row = next as Partial<NotificationRow> | null
  if (!row || typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.type !== 'string'
    || typeof row.is_read !== 'boolean' || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))
    || !(row.body === null || typeof row.body === 'string') || !(row.href === null || typeof row.href === 'string')) return null
  return [row as NotificationRow, ...rows.filter(item => item.id !== row.id)]
    .sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0,50)
}
