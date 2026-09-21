'use client'

import {
  CSSProperties,
  useEffect,
  useRef,
  useState,
} from 'react'

const CACHE_NAME = 'outing-mission-images-v1'

type Props = {
  missionId: string
  src: string
  alt: string
  style?: CSSProperties
  className?: string
}

export default function PersistentMissionImage({
  missionId,
  src,
  alt,
  style,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  const [displaySrc, setDisplaySrc] = useState('')
  const [shouldLoad, setShouldLoad] = useState(false)

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
        const cacheKey = new Request(
          `${window.location.origin}/__outing-cache/mission/${missionId}`,
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
              `Mission image fetch failed: ${response.status}`,
            )
          }

          await cache.put(cacheKey, response.clone())

          const blob = await response.blob()

          if (cancelled) return

          const objectUrl = URL.createObjectURL(blob)
          objectUrlRef.current = objectUrl
          setDisplaySrc(objectUrl)
          return
        }

        setDisplaySrc(src)
      } catch (error) {
        console.error(
          'Persistent mission image load error:',
          error,
        )

        if (!cancelled) {
          setDisplaySrc(src)
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
  }, [missionId, shouldLoad, src])

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
    </div>
  )
}