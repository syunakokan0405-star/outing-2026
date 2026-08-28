'use client'

import Link from 'next/link'
import { useState } from 'react'

export default function AdminUsersPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<'admin' | 'staff'>('staff')

  const [permissions, setPermissions] = useState({
    canManageMissions: false,
    canManageStream: false,
    canManagePhotos: false,
    canManageAwards: false,
    canManageGuide: false,
    canManageParticipants: false,
  })

  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  function togglePermission(key: keyof typeof permissions) {
    setPermissions((current) => ({
      ...current,
      [key]: !current[key],
    }))
  }

  async function createAdmin() {
    setError('')
    setMessage('')

    if (!email.trim()) {
      setError('メールアドレスを入力してください。')
      return
    }

    if (password.length < 8) {
      setError('初期パスワードは8文字以上にしてください。')
      return
    }

    if (!displayName.trim()) {
      setError('表示名を入力してください。')
      return
    }

    setSaving(true)

    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
          displayName,
          role,
          ...permissions,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || '管理者作成に失敗しました。')
      }

      setMessage(`「${displayName}」を管理者として追加しました。`)

      setEmail('')
      setPassword('')
      setDisplayName('')
      setRole('staff')

      setPermissions({
        canManageMissions: false,
        canManageStream: false,
        canManagePhotos: false,
        canManageAwards: false,
        canManageGuide: false,
        canManageParticipants: false,
      })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : '管理者作成に失敗しました。'
      )
    } finally {
      setSaving(false)
    }
  }

  const permissionItems = [
    ['canManageMissions', '🎯 Mission管理'],
    ['canManageStream', '💬 Stream管理'],
    ['canManagePhotos', '📷 写真管理'],
    ['canManageAwards', '🏆 Awards管理'],
    ['canManageGuide', '📅 Guide管理'],
    ['canManageParticipants', '👥 参加者管理'],
  ] as const

  return (
    <main
      className="grid"
      style={{
        maxWidth: 800,
        margin: '0 auto',
        padding: 24,
      }}
    >
      <div>
        <Link href="/admin" className="backLink">
          ← Dashboard
        </Link>

        <div className="brand" style={{ marginTop: 12 }}>
          OUTING 2026 ADMIN
        </div>

        <h1>管理者管理</h1>

        <p className="muted">
          新しい運営アカウントを作成し、操作権限を設定します。
        </p>
      </div>

      {error && (
        <section className="card">
          <b style={{ color: '#d33' }}>
            エラー：{error}
          </b>
        </section>
      )}

      {message && (
        <section className="card">
          <b style={{ color: '#148558' }}>
            ✓ {message}
          </b>
        </section>
      )}

      <section className="card grid">
        <h2>新しい管理者を追加</h2>

        <label>
          <b>表示名</b>
        </label>

        <input
          className="input"
          placeholder="例：運営 太郎"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />

        <label>
          <b>メールアドレス</b>
        </label>

        <input
          className="input"
          type="email"
          placeholder="example@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label>
          <b>初期パスワード</b>
        </label>

        <input
          className="input"
          type="password"
          placeholder="8文字以上"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <label>
          <b>役割</b>
        </label>

        <select
          className="input"
          value={role}
          onChange={(e) =>
            setRole(e.target.value as 'admin' | 'staff')
          }
        >
          <option value="staff">Staff</option>
          <option value="admin">Admin</option>
        </select>

        <div>
          <b>操作権限</b>

          <p className="muted" style={{ marginTop: 4 }}>
            このアカウントに許可する管理機能を選択します。
          </p>
        </div>

        <div className="grid">
          {permissionItems.map(([key, label]) => (
            <label
              key={key}
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'center',
              }}
            >
              <input
                type="checkbox"
                checked={permissions[key]}
                onChange={() => togglePermission(key)}
              />

              {label}
            </label>
          ))}
        </div>

        <button
          className="btn primary"
          onClick={() => void createAdmin()}
          disabled={saving}
        >
          {saving ? '作成中...' : '管理者を作成'}
        </button>
      </section>
    </main>
  )
}