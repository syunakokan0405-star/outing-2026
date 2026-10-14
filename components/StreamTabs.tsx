'use client'

import { useState } from 'react'
import LivePosts from '@/components/LivePosts'

export default function StreamTabs() {
  const [tab, setTab] = useState<'latest' | 'liked'>('latest')
  const [visitedLiked, setVisitedLiked] = useState(false)
  return (
    <>
      <div role="tablist" aria-label="ストリームの並び順" style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {(['latest', 'liked'] as const).map(value => (
          <button key={value} id={`stream-tab-${value}`} type="button" role="tab"
            tabIndex={tab === value ? 0 : -1}
            onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const next = event.key === 'Home' ? 'latest' : event.key === 'End' ? 'liked' : value === 'latest' ? 'liked' : 'latest'
              setTab(next)
              if (next === 'liked') setVisitedLiked(true)
              document.getElementById(`stream-tab-${next}`)?.focus()
            }}
            aria-selected={tab === value} aria-controls={`stream-panel-${value}`}
            onClick={() => { setTab(value); if (value === 'liked') setVisitedLiked(true) }}
            className="outingSerifEn"
            style={{ flex: 1, minHeight: 32, padding: '7px 8px', borderRadius: 7,
              fontSize: 11, fontWeight: 500, letterSpacing: '.13em', lineHeight: 1.4,
              cursor: 'pointer', border: '1px solid',
              color: tab === value ? '#fff' : 'rgba(255,255,255,.42)',
              background: tab === value ? 'rgba(113,72,215,.48)' : 'rgba(255,255,255,.04)',
              borderColor: tab === value ? 'rgba(182,155,255,.3)' : 'rgba(255,255,255,.1)' }}>
            {value === 'latest' ? 'Latest' : 'Liked'}
          </button>
        ))}
      </div>
      <div id="stream-panel-latest" role="tabpanel" aria-labelledby="stream-tab-latest" hidden={tab !== 'latest'}>
        <LivePosts mode="stream" active={tab === 'latest'} />
      </div>
      <div id="stream-panel-liked" role="tabpanel" aria-labelledby="stream-tab-liked" hidden={tab !== 'liked'}>
        {visitedLiked && <LivePosts mode="stream" order="liked" active={tab === 'liked'} />}
      </div>
    </>
  )
}
