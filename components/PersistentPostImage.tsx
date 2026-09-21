'use client'

import {
  CSSProperties,
  useEffect,
  useRef,
  useState,
} from 'react'

const CACHE_NAME = 'outing-post-images-v3'

type Props = {
  postId: string
  src: string
  alt: string
  style?: CSSProperties
  className?: string
}

export default function PersistentPostImage({
  postId,
  src,
  alt,
  style,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  const [displaySrc, setDisplaySrc] = useState('')
  const [shouldLoad, setShouldLoad] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const target = containerRef.current

    if (!target) return

    if (!('IntersectionObserver' in window)) {
      setShouldLoad(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShouldLoad(true)
          observer.disconnect()
        }
      },
      {
        rootMargin: '250px 0px',
      },
    )

    observer.observe(target)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!shouldLoad || !src) return

    let cancelled = false

    async function loadImage() {
      try {
        setFailed(false)

        // Signed URLは毎回変わるので、
        // postIdを使った固定URLをキャッシュキーにする。
        const cacheKey = new Request(
          `${window.location.origin}/__outing-cache/post-thumb/${postId}`,
        )

        if ('caches' in window) {
          const cache = await caches.open(CACHE_NAME)

          const cached = await cache.match(cacheKey)

          if (cached) {
            const blob = await cached.blob()

            if (cancelled) return

            const objectUrl = URL.createObjectURL(blob)
            objectUrlRef.current = objectUrl
            setDisplaySrc(objectUrl)

            return
          }

          const response = await fetch(src)

          if (!response.ok) {
            throw new Error(
              `Image fetch failed: ${response.status}`,
            )
          }

          // 端末のCache Storageへ保存
          await cache.put(cacheKey, response.clone())

          const blob = await response.blob()

          if (cancelled) return

          const objectUrl = URL.createObjectURL(blob)
          objectUrlRef.current = objectUrl
          setDisplaySrc(objectUrl)

          return
        }

        // Cache Storage非対応ブラウザ用
        setDisplaySrc(src)
      } catch (error) {
        console.error(
          'Persistent image load error:',
          error,
        )

        if (!cancelled) {
          // キャッシュ取得が失敗しても、
          // 通常のimg読み込みへフォールバック
          setDisplaySrc(src)
          setFailed(true)
        }
      }
    }

    void loadImage()

    return () => {
      cancelled = true

      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [postId, shouldLoad, src])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
      }}
    >
      {displaySrc ? (
        <img
          src={displaySrc}
          alt={alt}
          className={className}
          loading="lazy"
          decoding="async"
          style={style}
        />
      ) : (
        <div
          aria-hidden="true"
          style={{
            width: '100%',
            height: '100%',
            minHeight: 'inherit',
            background: 'rgba(255,255,255,.035)',
          }}
        />
      )}

      {failed && !displaySrc && (
        <span
          style={{
            display: 'none',
          }}
        >
          image unavailable
        </span>
      )}
    </div>
  )
}
