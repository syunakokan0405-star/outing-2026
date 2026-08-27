'use client'

import Link from 'next/link'
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type AdminContext = {
  id: string
  event_id: string
  display_name: string
}

export default function AdminStream(){
  const supabase=useMemo(()=>createClient(),[])
  const[admin,setAdmin]=useState<AdminContext|null>(null)
  const[title,setTitle]=useState('')
  const[body,setBody]=useState('')
  const[file,setFile]=useState<File|null>(null)
  const[preview,setPreview]=useState('')
  const[sending,setSending]=useState(false)
  const[message,setMessage]=useState('')
  const[error,setError]=useState('')

  useEffect(()=>{(async()=>{
    const{data:{user}}=await supabase.auth.getUser()
    if(!user){setError('運営ログインが必要です。');return}
    const{data,error:adminError}=await supabase
      .from('admin_users')
      .select('id,event_id,display_name')
      .eq('auth_user_id',user.id)
      .maybeSingle()
    if(adminError||!data){setError('Streamを管理できる運営アカウントではありません。');return}
    setAdmin(data)
  })()},[supabase])

  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview)},[preview])

  function chooseFile(e:ChangeEvent<HTMLInputElement>){
    const next=e.target.files?.[0]??null
    if(preview)URL.revokeObjectURL(preview)
    setFile(next)
    setPreview(next?URL.createObjectURL(next):'')
  }

  async function submit(e:FormEvent){
    e.preventDefault()
    if(!admin||!title.trim()||sending)return
    setSending(true);setError('');setMessage('')

    let imagePath:string|null=null
    if(file){
      if(!file.type.startsWith('image/')){setError('画像ファイルを選択してください。');setSending(false);return}
      if(file.size>12*1024*1024){setError('画像は12MB以下にしてください。');setSending(false);return}
      const ext=(file.name.split('.').pop()||'jpg').replace(/[^a-zA-Z0-9]/g,'').toLowerCase()||'jpg'
      imagePath=`${admin.event_id}/admin/${crypto.randomUUID()}.${ext}`
      const{error:uploadError}=await supabase.storage.from('outing-photos').upload(imagePath,file,{contentType:file.type,upsert:false})
      if(uploadError){setError(uploadError.message);setSending(false);return}
    }

    const{error:insertError}=await supabase.rpc('create_admin_stream_post',{
      p_event_id:admin.event_id,
      p_title:title.trim(),
      p_body:body.trim()||null,
      p_image_path:imagePath,
    })

    if(insertError){
      if(imagePath)await supabase.storage.from('outing-photos').remove([imagePath])
      setError(insertError.message);setSending(false);return
    }

    setTitle('');setBody('');setFile(null)
    if(preview)URL.revokeObjectURL(preview);setPreview('')
    setMessage('Streamへ公開しました。参加者画面にもリアルタイムで反映されます。')
    setSending(false)
  }

  return <main style={{maxWidth:760,margin:'0 auto',padding:24}} className="grid">
    <div><Link className="backLink" href="/admin">← Dashboard</Link><div className="brand" style={{marginTop:12}}>OUTING 2026 ADMIN</div><h1>Stream投稿</h1><p className="muted">交流会結果・Night Event・Pickupなどを参加者のStreamへ流します。</p></div>
    <form className="card adminForm" onSubmit={submit}>
      <label><b>タイトル</b></label>
      <input className="postInput" value={title} onChange={e=>setTitle(e.target.value)} maxLength={80} required placeholder="例：Night Eventスタート 🌙"/>
      <label><b>本文</b> <span className="muted">（任意）</span></label>
      <textarea className="postInput" rows={5} value={body} onChange={e=>setBody(e.target.value)} maxLength={500} placeholder="集合場所や結果など"/>
      <label><b>写真</b> <span className="muted">（任意）</span></label>
      <input type="file" accept="image/*" onChange={chooseFile}/>
      {preview&&<img className="adminPreview" src={preview} alt="投稿予定のプレビュー"/>}
      {error&&<div className="statusError">{error}</div>}
      {message&&<div className="statusSuccess">{message}</div>}
      <button className="btn primary" disabled={!admin||sending||!title.trim()}>{sending?'公開中…':'📣 Streamへ公開'}</button>
    </form>
  </main>
}
