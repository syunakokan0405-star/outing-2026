'use client'

import { FormEvent, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AdminLogin() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const search = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(search.get('error') === 'unauthorized' ? '運営権限のあるアカウントでログインしてください。' : '')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) {
      setError('メールアドレスまたはパスワードを確認してください。')
      setLoading(false)
      return
    }
    router.replace('/admin')
    router.refresh()
  }

  return <form onSubmit={submit} className="card grid" style={{ gap: 14 }}>
    <div><div className="brand">OUTING 2026</div><h1>Admin Login</h1><p className="muted">運営専用ログイン</p></div>
    <label>メールアドレス<input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    <label>パスワード<input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    {error && <p style={{ color: '#c33', fontWeight: 700 }}>{error}</p>}
    <button className="btn primary" disabled={loading}>{loading ? 'ログイン中…' : 'ログイン'}</button>
  </form>
}
