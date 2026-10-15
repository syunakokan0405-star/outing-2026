 'use client'
import { useEffect, useState } from 'react'
export default function HiddenBonusNotice() {
  const [points, setPoints] = useState(0)
  useEffect(() => {
    const onAward = (event: Event) => setPoints(p => p + (event as CustomEvent<number>).detail)
    window.addEventListener('outing:hidden-bonus', onAward)
    return () => window.removeEventListener('outing:hidden-bonus', onAward)
  }, [])
  if (!points) return null
  return <div role="dialog" aria-modal="true" aria-labelledby="hidden-bonus-title" className="hiddenBonusOverlay" onClick={() => setPoints(0)} onKeyDown={event => { if (event.key === 'Escape') setPoints(0) }}>
    <div className="glassCardStrong hiddenBonusCard" onClick={event => event.stopPropagation()}>
      <p className="outingSerifEn hiddenBonusEyebrow">HIDDEN BONUS</p>
      <h2 id="hidden-bonus-title" className="outingSerifJa hiddenBonusTitle">隠しポイント発見</h2>
      <p className="outingSerifEn hiddenBonusPoints">+{points}<span>PT</span></p>
      <button autoFocus type="button" className="outingSans hiddenBonusClose" onClick={() => setPoints(0)}>閉じる</button>
    </div>
  </div>
}
