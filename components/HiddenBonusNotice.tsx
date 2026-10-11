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
  return <div role="dialog" aria-modal="true" aria-label="隠しポイント獲得" style={{position:'fixed',inset:0,zIndex:10000,display:'grid',placeItems:'center',background:'rgba(0,0,0,.65)'}} onClick={() => setPoints(0)}>
    <div className="glassCardStrong" style={{padding:32,textAlign:'center',color:'#fff',maxWidth:320}} onClick={e => e.stopPropagation()}>
      <p>隠しポイント発見！</p><strong style={{fontSize:36}}>+{points} PT</strong>
      <p><button type="button" style={{border:'1px solid rgba(255,255,255,.2)',borderRadius:999,padding:'10px 28px',background:'rgba(128,84,220,.3)',color:'#fff',cursor:'pointer'}} onClick={() => setPoints(0)}>閉じる</button></p>
    </div>
  </div>
}
