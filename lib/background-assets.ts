// Background keys are immutable: replacements always receive a new UUID.
export function isBackgroundPath(path: string, eventId: string) {
  const key = path.startsWith('r2:') ? path.slice(3) : path
  const legacy = key.startsWith(`mission-backgrounds/${eventId}/`) || key.startsWith(`event-backgrounds/${eventId}/`)
  const current = path.startsWith('r2:') && key.startsWith(`assets/${eventId}/`)
  return (legacy || current) && !key.includes('..') && !/[\\?#\x00-\x1f]/.test(key)
}
export function backgroundAssetUrl(path: string) {
  return `/api/r2/assets?path=${encodeURIComponent(path)}`
}
export async function uploadBackgroundAsset(file: File, kind: 'mission' | 'home') {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml' || file.size > 12 * 1024 * 1024) {
    throw new Error('画像はSVG以外の12MB以下のファイルを選択してください。')
  }
  const response = await fetch('/api/r2/assets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, contentType: file.type }),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || '画像をアップロードできませんでした。')
  const uploaded = await fetch(result.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
  if (!uploaded.ok) throw new Error('R2への画像アップロードに失敗しました。')
  return result.path as string
}
