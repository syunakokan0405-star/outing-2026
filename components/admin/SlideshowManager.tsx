'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Download, Maximize, Pause, Play, RefreshCw, ShieldCheck } from 'lucide-react'
import { makeSlideshowZip, type OfflineSlide } from '@/lib/slideshow-offline'

type Slide = {
  id: string
  participant: string
  mission: string
  createdAt: string
  hearts: number
  hidden: boolean
}
type Order = 'random' | 'latest' | 'liked'

const CACHE_NAME = 'outing-slideshow-full-resolution-v1'
const POLL_MS = 60_000
const memoryLimit = 12

function cacheKey(id: string): Request {
  // Signed URLs expire; ID-based synthetic keys persist across refreshes.
  return new Request(window.location.origin + '/__outing-slideshow-cache/' + id)
}
function hashId(id: string, seed: number): number {
  let hash = seed || 7
  for (let i = 0; i < id.length; i += 1) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619)
  return hash >>> 0
}
async function getCache(): Promise<Cache | null> {
  if (!('caches' in window)) return null
  try { return await caches.open(CACHE_NAME) } catch { return null }
}

export default function SlideshowManager() {
  const [posts, setPosts] = useState<Slide[]>([])
  const [order, setOrder] = useState<Order>('random')
  const [seed, setSeed] = useState(1)
  const [intervalSeconds, setIntervalSeconds] = useState(6)
  const [viewer, setViewer] = useState(false)
  const [playing, setPlaying] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [loadedCount, setLoadedCount] = useState(0)
  const [version, setVersion] = useState(0)
  const [exportProgress, setExportProgress] = useState<number | null>(null)
  const [syncTime, setSyncTime] = useState('')
  const [busyPostId, setBusyPostId] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const memory = useRef(new Map<string, string>())
  const pending = useRef(new Set<string>())
  const revision = useRef(0)
  const manifestPosts = useRef<Slide[]>([])

  const visible = useMemo(() => {
    const rows = posts.filter(post => !post.hidden)
    if (order === 'latest') return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    if (order === 'liked') return rows.sort((a, b) => b.hearts - a.hearts || b.createdAt.localeCompare(a.createdAt))
    return rows.sort((a, b) => hashId(a.id, seed) - hashId(b.id, seed))
  }, [posts, order, seed])

  const activeIndex = useMemo(() => visible.findIndex(item => item.id === activeId), [visible, activeId])
  const current = visible[activeIndex >= 0 ? activeIndex : 0]
  const currentSrc = current ? memory.current.get(current.id) : undefined
  void version // triggers render after Blob URLs enter the in-memory cache

  const refresh = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    try {
      const response = await fetch('/api/admin/slideshow', { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? '一覧を取得できませんでした。')
      const list = (body.posts ?? []) as Slide[]
      setPosts(list)
      manifestPosts.current = list
      setSyncTime(new Date().toLocaleTimeString('ja-JP'))
      setError('')
      if (body.truncated) setNotice('投稿数が多いため、直近3000件が対象です。')
      // Purge excluded/deleted photos, so operator changes also invalidate local playback.
      const valid = new Set(list.filter(post => !post.hidden).map(post => post.id))
      for (const [id, url] of memory.current) {
        if (!valid.has(id)) { URL.revokeObjectURL(url); memory.current.delete(id) }
      }
      const cache = await getCache()
      if (cache) {
        const keys = await cache.keys()
        await Promise.all(keys.filter(key => !valid.has(key.url.split('/').pop() ?? '')).map(key => cache.delete(key)))
        setLoadedCount((await cache.keys()).length)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新できませんでした。')
      // Keep the last successful manifest/photos playing during Wi-Fi interruptions.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh(true)
    const timer = window.setInterval(() => { void refresh() }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    return () => {
      for (const url of memory.current.values()) URL.revokeObjectURL(url)
      memory.current.clear()
    }
  }, [])

  useEffect(() => {
    if (!visible.length) setActiveId(null)
    else if (!visible.some(post => post.id === activeId)) setActiveId(visible[0].id)
  }, [visible, activeId])

  const ensureImages = useCallback(async (ids: string[]) => {
    const fresh = [...new Set(ids)].filter(id => !memory.current.has(id) && !pending.current.has(id))
    if (!fresh.length) return
    for (const id of fresh) pending.current.add(id)
    try {
      const cache = await getCache()
      const missing: string[] = []
      for (const id of fresh) {
        const response = await cache?.match(cacheKey(id))
        if (response) {
          const url = URL.createObjectURL(await response.blob())
          memory.current.set(id, url)
        } else missing.push(id)
      }
      if (missing.length) {
        for (let i = 0; i < missing.length; i += 20) {
          const chunk = missing.slice(i, i + 20)
          const response = await fetch('/api/admin/slideshow/urls', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ postIds: chunk }),
          })
          const body = await response.json()
          if (!response.ok) throw new Error(body.error ?? '写真の取得に失敗しました。')
          await Promise.all(chunk.map(async id => {
            const src: string | undefined = body.urls?.[id]
            if (!src) return
            const imageResponse = await fetch(src)
            if (!imageResponse.ok) throw new Error('写真の取得に失敗しました (' + imageResponse.status + ')')
            const blob = await imageResponse.blob()
            if (!blob.size || !blob.type.startsWith('image/')) throw new Error('画像形式が不正です。')
            // Cache Storage can be evicted by the browser; it is a performance cache, not an archive.
            await cache?.put(cacheKey(id), new Response(blob, { headers: { 'Content-Type': blob.type } })).catch(() => {})
            memory.current.set(id, URL.createObjectURL(blob))
          }))
        }
      }
      // Keep only a small number of object URLs in RAM; every other photo lives on disk cache.
      const keys = [...memory.current.keys()]
      for (const id of keys.slice(0, Math.max(0, keys.length - memoryLimit))) {
        if (id === activeId) continue
        const url = memory.current.get(id)
        if (url) URL.revokeObjectURL(url)
        memory.current.delete(id)
      }
      if (cache) setLoadedCount((await cache.keys()).length)
      setVersion(v => v + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : '写真を読み込めませんでした。')
    } finally {
      for (const id of fresh) pending.current.delete(id)
    }
  }, [activeId])

  useEffect(() => {
    if (!current || !viewer) return
    const ids = [current.id]
    for (let i = 1; i <= 3 && i < visible.length; i += 1) ids.push(visible[((activeIndex < 0 ? 0 : activeIndex) + i) % visible.length].id)
    void ensureImages(ids)
  }, [current, viewer, activeIndex, visible, ensureImages])

  const move = useCallback((step: number) => {
    if (!visible.length) return
    setActiveId(id => {
      const idx = Math.max(0, visible.findIndex(row => row.id === id))
      return visible[(idx + step + visible.length) % visible.length].id
    })
  }, [visible])

  useEffect(() => {
    if (!viewer || !playing || visible.length < 2) return
    const timer = window.setInterval(() => move(1), intervalSeconds * 1000)
    return () => window.clearInterval(timer)
  }, [viewer, playing, visible.length, intervalSeconds, move])

  useEffect(() => {
    if (!viewer) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); move(1) }
      if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1) }
      if (e.key === ' ') { e.preventDefault(); setPlaying(value => !value) }
      if (e.key === 'Escape') setViewer(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewer, move])

  const start = () => {
    if (!visible.length) return
    setViewer(true)
    setPlaying(true)
    setNotice('')
    // User gesture is required for fullscreen. The page still works if denied.
    void rootRef.current?.requestFullscreen?.().catch(() => {
      setNotice('全画面にできない場合はブラウザの F11 を押してください。')
    })
  }
  const stop = () => {
    setViewer(false)
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  }

  const setHidden = async (post: Slide) => {
    if (busyPostId) return
    setBusyPostId(post.id)
    try {
      const response = await fetch('/api/admin/slideshow', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: post.id, hidden: !post.hidden }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? '設定を保存できませんでした。')
      setPosts(rows => rows.map(row => row.id === post.id ? { ...row, hidden: !post.hidden } : row))
      setNotice(post.hidden ? '上映対象に戻しました。' : 'この投稿を上映から除外しました。')
      if (!post.hidden) {
        const url = memory.current.get(post.id)
        if (url) URL.revokeObjectURL(url)
        memory.current.delete(post.id)
        const cache = await getCache()
        await cache?.delete(cacheKey(post.id))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '設定を保存できませんでした。')
    } finally { setBusyPostId('') }
  }

  const downloadOffline = async () => {
    if (exportProgress !== null || !visible.length) return
    setExportProgress(0)
    setError('')
    const files: OfflineSlide[] = []
    const cache = await getCache()
    try {
      for (let i = 0; i < visible.length; i += 4) {
        const batch = visible.slice(i, i + 4)
        await ensureImages(batch.map(post => post.id))
        for (const post of batch) {
          let blob = await cache?.match(cacheKey(post.id)).then(r => r?.blob())
          if (!blob) {
            const url = memory.current.get(post.id)
            if (url) blob = await fetch(url).then(r => r.blob())
          }
          if (!blob) throw new Error(post.participant + ' の画像を保存できませんでした。')
          files.push({ id: post.id, participant: post.participant, mission: post.mission,
            createdAt: post.createdAt, hearts: post.hearts, blob })
        }
        setExportProgress(Math.round(100 * Math.min(visible.length, i + batch.length) / visible.length))
      }
      const archive = await makeSlideshowZip(files, intervalSeconds)
      const url = URL.createObjectURL(archive)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'outing-2026-slideshow-' + new Date().toISOString().slice(0, 10) + '.zip'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
      setNotice('オフライン用ZIPを保存しました。展開後 index.html を開いてください。')
    } catch (e) {
      setError(e instanceof Error ? e.message : '一括保存に失敗しました。')
    } finally { setExportProgress(null) }
  }

  const displayed = posts.filter(post => (post.participant + ' ' + post.mission).toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const button = { cursor: 'pointer', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.14)',
    borderRadius: 10, color: 'white', padding: '12px 16px', fontSize: 12 } as const

  return (
    <div ref={rootRef} className="outingSans" style={{ background: '#080b10', minHeight: '100vh', color: 'white' }}>
      {viewer ? (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: '#020304', overflow: 'hidden' }}>
          {currentSrc ? (
            <img key={current?.id} src={currentSrc} alt={current?.mission ?? 'Outing photo'}
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', animation: 'outingSlideFade .65s ease' }} />
          ) : (
            <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#888' }}>高画質画像を読み込み中…</div>
          )}
          <div style={{ position: 'absolute', top: 26, left: '4%', fontSize: 13, letterSpacing: '.24em', textShadow: '0 1px 8px #000' }}>OUTING 2026</div>
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, pointerEvents: 'none',
            padding: '90px 4% 35px', background: 'linear-gradient(transparent,rgba(0,0,0,.85))' }}>
            <div style={{ fontSize: 'clamp(24px,3.4vw,52px)', fontWeight: 300 }}>{current?.participant}</div>
            <div style={{ opacity: .8, fontSize: 'clamp(13px,1.5vw,23px)', marginTop: 6 }}>{current?.mission}</div>
          </div>
          <div style={{ position: 'absolute', top: 18, right: 22, display: 'flex', alignItems: 'center', gap: 8 }}>
            <button style={button} onClick={() => move(-1)} title="前の写真"><ArrowLeft size={18} /></button>
            <button style={button} onClick={() => setPlaying(v => !v)} title={playing ? '一時停止' : '再開'}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
            <button style={button} onClick={() => move(1)} title="次の写真"><ArrowRight size={18} /></button>
            <button style={button} onClick={stop}>EXIT</button>
          </div>
          <div style={{ position: 'absolute', bottom: 16, right: 22, fontSize: 11, opacity: .6 }}>
            {(activeIndex < 0 ? 0 : activeIndex) + 1} / {visible.length} · {playing ? 'LIVE' : 'PAUSED'}
            {error ? ' · 接続確認中（キャッシュ再生）' : ''}
          </div>
          <style>{'@keyframes outingSlideFade { from { opacity:0 } to { opacity:1 } }'}</style>
        </div>
      ) : (
        <main style={{ maxWidth: 1040, padding: '32px 20px 80px', margin: '0 auto' }}>
          <Link href="/admin" style={{ color: '#aaa', fontSize: 12 }}>← ADMIN DASHBOARD</Link>
          <div style={{ fontSize: 11, opacity: .5, letterSpacing: '.2em', marginTop: 35 }}>OUTING 2026 / ADMIN</div>
          <h1 style={{ fontSize: 40, fontWeight: 300, letterSpacing: '.1em', margin: '8px 0 6px' }}>SLIDESHOW</h1>
          <p style={{ color: '#9ca3af', fontSize: 13, lineHeight: 1.8 }}>本画像をPCにキャッシュし、写真の再生を続けながら60秒ごとに新しい投稿を確認します。投稿テストの写真は除外済みです。</p>
          <section style={{ marginTop: 25, display: 'flex', gap: 15, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ fontSize: 14 }}>{loading ? '取得中…' : visible.length + ' 枚上映可能'}</div>
            <div style={{ fontSize: 12, color: '#aaa' }}>キャッシュ済み {loadedCount} 枚</div>
            <div style={{ fontSize: 12, color: '#aaa' }}>最終更新 {syncTime || '—'}</div>
            <button style={button} onClick={() => { setUpdating(true); void refresh().finally(() => setUpdating(false)) }} disabled={updating}>
              <RefreshCw size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />{updating ? '更新中' : '更新'}
            </button>
          </section>
          {error && <p role="alert" style={{ color: '#ff9999', fontSize: 13 }}>{error}</p>}
          {notice && <p role="status" style={{ color: '#c3d2c2', fontSize: 13 }}>{notice}</p>}
          <section style={{ marginTop: 22, padding: 24, border: '1px solid #292f39', borderRadius: 16, background: '#10131b' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-end' }}>
              <label style={{ display: 'grid', gap: 9, fontSize: 11, letterSpacing: '.12em', color: '#aaa' }}>
                PLAY ORDER
                <select value={order} onChange={e => setOrder(e.target.value as Order)}
                  style={{ ...button, minWidth: 160 }}>
                  <option value="random">RANDOM</option>
                  <option value="latest">LATEST</option>
                  <option value="liked">LIKED (TOP 15)</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: 9, fontSize: 11, letterSpacing: '.12em', color: '#aaa' }}>
                INTERVAL
                <select value={intervalSeconds} onChange={e => setIntervalSeconds(Number(e.target.value))}
                  style={{ ...button, minWidth: 130 }}>
                  {[5, 6, 8, 10].map(s => <option key={s} value={s}>{s} SECONDS</option>)}
                </select>
              </label>
              {order === 'random' && <button style={button} onClick={() => setSeed(v => v + 1)}>RESHUFFLE</button>}
            </div>
            <button onClick={start} disabled={!visible.length}
              style={{ ...button, background: visible.length ? '#e9e9ec' : '#555', color: '#07090e', marginTop: 25,
                padding: '14px 28px', fontSize: 14, fontWeight: 600, opacity: visible.length ? 1 : .5 }}>
              <Maximize size={17} style={{ verticalAlign: 'middle', marginRight: 9 }} />START SLIDESHOW
            </button>
            <p style={{ color: '#999', fontSize: 12, lineHeight: 1.7, marginTop: 12 }}>PCのブラウザをプロジェクターに移してから開始。HDMI接続・拡張画面がおすすめです。</p>
          </section>
          <section style={{ marginTop: 20, padding: 24, border: '1px solid #292f39', borderRadius: 16 }}>
            <h2 style={{ fontWeight: 400, margin: 0, fontSize: 18 }}>OFFLINE BACKUP</h2>
            <p style={{ color: '#9ca3af', fontSize: 12, lineHeight: 1.7 }}>通常の上映には使いません。万が一のネット断に備え、必要な時だけ写真と再生ページをZIPで保存できます。</p>
            <button style={button} disabled={exportProgress !== null || !visible.length} onClick={() => { void downloadOffline() }}>
              <Download size={16} style={{ verticalAlign: 'middle', marginRight: 9 }} />
              {exportProgress === null ? 'DOWNLOAD OFFLINE ZIP' : 'DOWNLOADING ' + exportProgress + '%'}
            </button>
            <p style={{ color: '#777', fontSize: 11 }}>ブラウザキャッシュは容量制限で削除される場合があります。ZIPは別途PCに保存されます。</p>
          </section>
          <section style={{ marginTop: 30 }}>
            <h2 style={{ fontWeight: 400, fontSize: 20 }}>DISPLAY CONTROL</h2>
            <p style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#aaa', fontSize: 12 }}>
              <ShieldCheck size={16} />「投稿テスト　自由！」はミッションIDで常時除外。ここで個別非表示にしても投稿やポイントは変わりません。
            </p>
            <input type="search" placeholder="名前・ミッションで検索" value={query} onChange={e => setQuery(e.target.value)}
              style={{ ...button, width: '100%', maxWidth: 400, boxSizing: 'border-box', margin: '12px 0 20px' }} />
            <div style={{ display: 'grid', gap: 8 }}>
              {displayed.map(post => (
                <div key={post.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
                  justifyContent: 'space-between', border: '1px solid #262a34', borderRadius: 12, padding: '12px 16px', opacity: post.hidden ? .5 : 1 }}>
                  <div style={{ minWidth: 180, flex: 1 }}>
                    <div style={{ fontSize: 14 }}>{post.participant} <span style={{ color: '#888', fontSize: 11, marginLeft: 6 }}>{post.hearts ? '♥ ' + post.hearts : ''}</span></div>
                    <div style={{ fontSize: 12, color: '#999', marginTop: 5 }}>{post.mission || 'Mission'}</div>
                  </div>
                  <button style={button} disabled={!!busyPostId} onClick={() => { void setHidden(post) }}>
                    {busyPostId === post.id ? 'SAVING…' : post.hidden ? 'SHOW' : 'HIDE'}
                  </button>
                </div>
              ))}
            </div>
            {!displayed.length && <p style={{ color: '#999' }}>{loading ? '読み込み中…' : '該当する投稿はありません。'}</p>}
          </section>
        </main>
      )}
    </div>
  )
}
