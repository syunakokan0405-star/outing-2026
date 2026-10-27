'use client'
import { useRef, useState } from 'react'
import { makeZip } from '@/lib/zip'

type ExportPost = { id: string; kind: string; hasImage: boolean }

export default function PhotoExport() {
  const lock = useRef(false)
  const [progress, setProgress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function download() {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setProgress('投稿一覧を取得中…')
    try {
      const response = await fetch('/api/admin/photos/export', { cache: 'no-store' })
      const manifest = await response.json()
      if (!response.ok) throw new Error(manifest.error)
      const posts = manifest.posts as ExportPost[]
      const images = posts.filter(p => p.hasImage)
      const files: { name: string; blob: Blob }[] = []
      for (let index = 0; index < images.length; index++) {
        const post = images[index]
        setProgress(`写真を取得中 ${index + 1} / ${images.length}`)
        let image: Response | undefined
        for (let attempt = 0; attempt < 3; attempt++) {
          image = await fetch(`/api/admin/photos/export?id=${encodeURIComponent(post.id)}&kind=${post.kind}`, { cache: 'no-store' })
          if (image.ok) break
        }
        if (!image?.ok) throw new Error(`写真 ${post.id} の取得に失敗しました。ZIPは未完成です。再実行してください。`)
        const blob = await image.blob()
        if (!blob.size) throw new Error(`写真 ${post.id} が空です。`)
        const extension = ({ 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' } as Record<string, string>)[blob.type] || 'bin'
        const name = `photos/${post.kind}-${post.id}.${extension}`
        Object.assign(post, { file: name })
        files.push({ name, blob })
      }
      setProgress('ZIPを作成中…')
      files.push({ name: 'posts.json', blob: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }) })
      files.push({ name: 'README.txt', blob: new Blob(['Outing 2026 全投稿\n写真は保存されている元ファイルです（再圧縮なし）。\nposts.jsonに投稿者・ミッション・コメント・投稿日時・写真ファイル名を記録しています。\n取り消し・削除済みの投稿は含みません。\n'], { type: 'text/plain;charset=utf-8' }) })
      const url = URL.createObjectURL(await makeZip(files))
      const a = document.createElement('a'); a.href = url; a.download = `outing-2026-all-posts-${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(a); a.click(); a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setProgress(`${posts.length}件の投稿・${images.length}枚の写真：ZIPの保存を開始しました。`)
    } catch (e) { setError(e instanceof Error ? e.message : 'ダウンロードできませんでした。') }
    finally { lock.current = false; setBusy(false) }
  }
  return <section className="card grid">
    <h2>全投稿の保存</h2><p className="muted">全参加者・全ページの投稿と運営投稿をZIPで保存します。投稿テスト・Galleryも含みます。取り消し・削除済みは対象外です。写真は再圧縮しません。</p>
    <button className="btn primary" disabled={busy} onClick={() => void download()}>{busy ? 'ダウンロード準備中…' : '全投稿をZIPでダウンロード'}</button>
    {progress && <p role="status">{progress}</p>}{error && <p role="alert">{error}</p>}
  </section>
}
