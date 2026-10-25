'use client'

import { useEffect, useRef, useState } from 'react'

// The full photo, including after a 90/270 degree correction, is always
// mathematically contained within the measured stage: never use object-fit: cover.
export default function ContainedSlideshowImage({
  src,
  rotation,
  alt,
}: {
  src: string
  rotation: number
  alt: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const [bounds, setBounds] = useState({ width: 0, height: 0 })
  const [natural, setNatural] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const element = root.current
    if (!element) return
    const resize = () => setBounds({
      width: element.clientWidth,
      height: element.clientHeight,
    })
    resize()
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(resize)
      : null
    observer?.observe(element)
    if (!observer) window.addEventListener('resize', resize)
    return () => {
      observer?.disconnect()
      if (!observer) window.removeEventListener('resize', resize)
    }
  }, [])

  const quarterTurn = rotation % 180 !== 0
  const rotatedWidth = quarterTurn ? natural.height : natural.width
  const rotatedHeight = quarterTurn ? natural.width : natural.height
  const ready = rotatedWidth > 0 && rotatedHeight > 0 &&
    bounds.width > 0 && bounds.height > 0
  const scale = ready
    ? Math.min(
        Math.max(1, bounds.width - 24) / rotatedWidth,
        Math.max(1, bounds.height - 24) / rotatedHeight,
      )
    : 0

  return (
    <div ref={root} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <img
        src={src}
        alt={alt}
        onLoad={event => {
          const image = event.currentTarget
          setNatural({ width: image.naturalWidth, height: image.naturalHeight })
        }}
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: ready ? natural.width * scale : 1,
          height: ready ? natural.height * scale : 1,
          minWidth: 0,
          minHeight: 0,
          maxWidth: 'none',
          maxHeight: 'none',
          objectFit: 'fill',
          transformOrigin: 'center',
          transform: 'translate(-50%, -50%) rotate(' + rotation + 'deg)',
          opacity: ready ? 1 : 0,
          display: 'block',
          animation: ready ? 'outingSlideFade .65s ease' : undefined,
        }}
      />
    </div>
  )
}
