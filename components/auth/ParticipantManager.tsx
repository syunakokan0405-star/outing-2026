
'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type ParticipantRow = {
  id: string
  name: string
  claimed_at: string | null
  auth_user_id: string | null
  is_active: boolean
}

export default function ParticipantManager({
  eventId,
}: {
  eventId: string
}) {
  const supabase = useMemo(() => createClient(), [])

  const [rows, setRows] = useState<ParticipantRow[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [newName, setNewName] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    setLoading(true)

    const { data, error } = await supabase
      .from('participants')
      .select('id,name,claimed_at,auth_user_id,is_active')
      .eq('event_id', eventId)
      .order('name')

    if (error) {
      setMessage(error.message)
    } else {
      setRows((data ?? []) as ParticipantRow[])
    }

    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  async function addParticipant() {
    const name = newName.trim()

    if (!name) {
      setMessage('名前を入力してください。')
      return
    }

    setBusyId('new')
    setMessage('')

    const { error } = await supabase.rpc('create_participant', {
      p_event_id: eventId,
      p_name: name,
    })

    if (error) {
      setMessage(error.message)
      setBusyId(null)
      return
    }

    setNewName('')
    setMessage(`「${name}」を追加しました。`)
    setBusyId(null)
    await load()
  }

  async function renameParticipant(row: ParticipantRow) {
    const nextName = window.prompt('新しい名前を入力してください。', row.name)

    if (nextName === null) return

    const name = nextName.trim()

    if (!name) {
      setMessage('名前を空欄にはできません。')
      return
    }

    if (name === row.name) return

    setBusyId(row.id)
    setMessage('')

    const { error } = await supabase.rpc('rename_participant', {
      p_participant_id: row.id,
      p_name: name,
    })

    if (error) {
      setMessage(error.message)
      setBusyId(null)
      return
    }

    setMessage(`「${row.name}」→「${name}」に変更しました。`)
    setBusyId(null)
    await load()
  }

  async function unlock(id: string, name: string) {
    if (!window.confirm(`${name} の端末ロックを解除しますか？`)) return

    setBusyId(id)
    setMessage('')

    const { error } = await supabase.rpc('reset_participant_claim', {
      p_participant_id: id,
    })

    if (error) {
      setMessage(error.message)
      setBusyId(null)
      return
    }

    setMessage(`${name} の端末ロックを解除しました。`)
    setBusyId(null)
    await load()
  }

  async function toggleActive(row: ParticipantRow) {
    const nextActive = !row.is_active

    const text = nextActive
      ? `${row.name} を有効に戻しますか？`
      : `${row.name} を無効にしますか？`

    if (!window.confirm(text)) return

    setBusyId(row.id)
    setMessage('')

    const { error } = await supabase.rpc('set_participant_active', {
      p_participant_id: row.id,
      p_is_active: nextActive,
    })

    if (error) {
      setMessage(error.message)
      setBusyId(null)
      return
    }

    setMessage(
      `${row.name} を${nextActive ? '有効' : '無効'}にしました。`
    )
    setBusyId(null)
    await load()
  }

  const filtered = rows.filter((row) =>
    row.name.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div className="grid">
      <div className="row">
        <div>
          <div className="brand">OUTING 2026 ADMIN</div>
          <h1>参加者管理</h1>
        </div>

        <span className="muted">{rows.length}人</span>
      </div>

      <section className="card grid">
        <h2>参加者を追加</h2>

        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <input
            className="input"
            style={{ flex: '1 1 240px' }}
            placeholder="参加者名"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void addParticipant()
              }
            }}
          />

          <button
            className="btn primary"
            onClick={() => void addParticipant()}
            disabled={busyId === 'new'}
          >
            {busyId === 'new' ? '追加中...' : '＋ 追加'}
          </button>
        </div>
      </section>

      <section className="card grid">
        <input
          className="input"
          placeholder="名前で検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {message && <div className="muted">{message}</div>}

        {loading ? (
          <p className="muted">読み込み中...</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="adminTable">
              <thead>
                <tr>
                  <th>名前</th>
                  <th>端末</th>
                  <th>Claim日時</th>
                  <th>状態</th>
                  <th>操作</th>
                </tr>
              </thead>

              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <b>{row.name}</b>
                    </td>

                    <td>
                      <span
                        className={`statusDot ${
                          row.auth_user_id ? 'on' : 'off'
                        }`}
                      />
                      {row.auth_user_id
                        ? 'Claim済み'
                        : '未使用'}
                    </td>

                    <td>
                      {row.claimed_at
                        ? new Date(row.claimed_at).toLocaleString('ja-JP')
                        : '—'}
                    </td>

                    <td>
                      {row.is_active ? '有効' : '無効'}
                    </td>

                    <td>
                      <div
                        style={{
                          display: 'flex',
                          gap: 6,
                          flexWrap: 'wrap',
                        }}
                      >
                        <button
                          className="btn outline"
                          onClick={() => void renameParticipant(row)}
                          disabled={busyId === row.id}
                        >
                          名前編集
                        </button>

                        {row.auth_user_id && (
                          <button
                            className="btn outline"
                            onClick={() => void unlock(row.id, row.name)}
                            disabled={busyId === row.id}
                          >
                            Claim解除
                          </button>
                        )}

                        <button
                          className="btn outline"
                          onClick={() => void toggleActive(row)}
                          disabled={busyId === row.id}
                        >
                          {row.is_active ? '無効化' : '有効化'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}