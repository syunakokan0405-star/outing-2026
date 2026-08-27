'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AdminLogout() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  return <button className="btn outline" onClick={async () => { await supabase.auth.signOut(); router.replace('/admin/login'); router.refresh() }}>ログアウト</button>
}
