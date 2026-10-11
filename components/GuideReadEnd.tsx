 'use client'
import { useEffect, useRef } from 'react'
import { claimHiddenBonus } from '@/lib/hidden-bonus'
export default function GuideReadEnd({ kind }: { kind: 'schedule_read' | 'rules_read' }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    let claimed = false, pending = false
    const observer = new IntersectionObserver(async entries => {
      if (claimed || pending || !entries.some(e => e.isIntersecting) || !node.closest('details')?.open || document.visibilityState !== 'visible') return
      pending = true
      claimed = await claimHiddenBonus(kind)
      pending = false
    }, { threshold: 1, rootMargin: '0px 0px -85px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [kind])
  return <div ref={ref} style={{height:2}} aria-hidden="true" />
}
