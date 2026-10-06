import type { createClient } from '@/lib/supabase/client'

export const PROFILE_UPDATED_EVENT = 'outing-profile-updated'

// R2 avatar uploads use WebP; older Supabase avatars use JPG.
export function isR2Avatar(path: string) {
  return path.startsWith('avatars/') && path.endsWith('.webp')
}

export async function avatarUrlMap(
  supabase: ReturnType<typeof createClient>,
  avatars: { id: string; avatar_path: string | null }[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const legacyPaths = [...new Set(avatars.map(a => a.avatar_path ?? '')
    .filter(path => path && !isR2Avatar(path)))]
  const r2Avatars = avatars.filter(a => a.avatar_path && isR2Avatar(a.avatar_path))
  const results = await Promise.allSettled([
    (async () => {
      if (!legacyPaths.length) return
      const { data, error } = await supabase.storage.from('outing-photos')
        .createSignedUrls(legacyPaths, 60 * 60)
      if (error) throw error
      for (const entry of data ?? []) {
        if (entry.path && entry.signedUrl) map.set(entry.path, entry.signedUrl)
      }
    })(),
    (async () => {
      const ids = [...new Set(r2Avatars.map(a => a.id))]
      for (let start = 0; start < ids.length; start += 150) {
        const response = await fetch('/api/r2/avatar-read-urls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ participantIds: ids.slice(start, start + 150) }),
        })
        if (!response.ok) throw new Error('プロフィール画像URLを取得できませんでした。')
        const { urls } = await response.json() as { urls: Record<string, string> }
        for (const avatar of r2Avatars) {
          if (avatar.avatar_path && urls[avatar.id]) map.set(avatar.avatar_path, urls[avatar.id])
        }
      }
    })(),
  ])
  if (results.some(result => result.status === 'rejected')) {
    console.error('Some profile photos could not be loaded.')
  }
  return map
}
