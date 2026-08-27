import { Suspense } from 'react'
import AdminLogin from '@/components/auth/AdminLogin'

export const dynamic = 'force-dynamic'

export default function AdminLoginPage() {
  return <main className="shell"><Suspense fallback={<div className="card">読み込み中…</div>}><AdminLogin /></Suspense></main>
}
