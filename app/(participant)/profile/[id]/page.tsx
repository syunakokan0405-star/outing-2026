'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import LivePosts from '@/components/LivePosts'
import { createClient } from '@/lib/supabase/client'

export default function ParticipantProfile(){
  const params=useParams<{id:string}>()
  const participantId=params.id
  const supabase=useMemo(()=>createClient(),[])
  const[name,setName]=useState('Participant')
  const[error,setError]=useState('')

  useEffect(()=>{(async()=>{
    const {data,error:profileError}=await supabase
      .from('participants')
      .select('name')
      .eq('id',participantId)
      .maybeSingle()
    if(profileError||!data){setError('プロフィールを表示できませんでした。');return}
    setName(data.name)
  })()},[participantId,supabase])

  return <main className="shell grid">
    <div><Link className="backLink" href="/stream">← Stream</Link><div className="brand" style={{marginTop:12}}>OUTING 2026</div></div>
    <section className="card profileHeader">
      <div className="profileAvatar">👤</div>
      <div><h1 style={{margin:'0 0 4px'}}>{name}</h1><p className="muted" style={{margin:0}}>Public Gallery</p></div>
    </section>
    {error ? <section className="card"><b>{error}</b></section> : <>
      <section><h2 className="galleryHeading">Gallery</h2><p className="muted">この人がOuting 2026で投稿した写真。</p></section>
      <LivePosts mode="gallery" participantId={participantId}/>
    </>}
  </main>
}
