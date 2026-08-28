'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type MissionForm = {
  title: string
  difficulty: 'easy' | 'normal' | 'hard'
  points: number
  required_mentions: number
}

const initialMissions: MissionForm[] = [
  {
    title: '違う学年の人と写真！',
    difficulty: 'normal',
    points: 20,
    required_mentions: 1,
  },
  {
    title: '今日初めて話した人と写真！',
    difficulty: 'easy',
    points: 10,
    required_mentions: 1,
  },
  {
    title: '違うクラスの3人と写真！',
    difficulty: 'hard',
    points: 30,
    required_mentions: 3,
  },
]

export default function AdminMissions() {
  const supabase = useMemo(() => createClient(), [])

  const [missions, setMissions] =
    useState<MissionForm[]>(initialMissions)

  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const eventId = process.env.NEXT_PUBLIC_EVENT_ID

  function updateMission(
    index: number,
    field: keyof MissionForm,
    value: string | number
  ) {
    setMissions((current) =>
      current.map((mission, i) =>
        i === index
          ? {
              ...mission,
              [field]: value,
            }
          : mission
      )
    )
  }

  async function createDrop() {
    setMessage('')
    setError('')

    if (!eventId) {
      setError('EVENT IDが設定されていません。')
      return
    }

    if (missions.some((mission) => !mission.title.trim())) {
      setError('Mission名をすべて入力してください。')
      return
    }

    if (
      missions.some(
        (mission) =>
          mission.points < 0 ||
          mission.required_mentions < 0
      )
    ) {
      setError('得点・必要メンション人数を確認してください。')
      return
    }

    const confirmed = window.confirm(
      'この3つのMissionを参加者へ配布します。\n公開後すぐに参加者へ表示されます。\n\n実行しますか？'
    )

    if (!confirmed) return

    setLoading(true)

    try {
      const { data, error: rpcError } = await supabase.rpc(
        'create_mission_drop',
        {
          p_event_id: eventId,
          p_missions: missions,
        }
      )

      if (rpcError) {
        throw rpcError
      }

      setMessage(
        `Mission Dropを配布しました！ Drop ID: ${data}`
      )
    } catch (err: any) {
      console.error(err)
      setError(
        err?.message ??
          'Mission Dropの配布に失敗しました。'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <main
      style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: 24,
      }}
      className="grid"
    >
      <div>
        <div className="brand">OUTING 2026 ADMIN</div>
        <h1>Create Mission Drop</h1>
        <p className="muted">
          3つのMissionを作成し、参加者へSmart Shuffleで均等に配布します。
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit,minmax(260px,1fr))',
          gap: 12,
        }}
      >
        {missions.map((mission, index) => (
          <section className="card" key={index}>
            <h2>
              Mission {String.fromCharCode(65 + index)}
            </h2>

            <label>Mission名</label>
            <input
              value={mission.title}
              onChange={(e) =>
                updateMission(
                  index,
                  'title',
                  e.target.value
                )
              }
              style={{
                width: '100%',
                padding: 10,
                margin: '6px 0 12px',
              }}
            />

            <label>難易度</label>
            <select
              value={mission.difficulty}
              onChange={(e) =>
                updateMission(
                  index,
                  'difficulty',
                  e.target.value
                )
              }
              style={{
                width: '100%',
                padding: 10,
                margin: '6px 0 12px',
              }}
            >
              <option value="easy">Easy</option>
              <option value="normal">Normal</option>
              <option value="hard">Hard</option>
            </select>

            <label>得点</label>
            <input
              type="number"
              min="0"
              value={mission.points}
              onChange={(e) =>
                updateMission(
                  index,
                  'points',
                  Number(e.target.value)
                )
              }
              style={{
                width: '100%',
                padding: 10,
                margin: '6px 0 12px',
              }}
            />

            <label>必要メンション人数</label>
            <input
              type="number"
              min="0"
              value={mission.required_mentions}
              onChange={(e) =>
                updateMission(
                  index,
                  'required_mentions',
                  Number(e.target.value)
                )
              }
              style={{
                width: '100%',
                padding: 10,
                marginTop: 6,
              }}
            />
          </section>
        ))}
      </div>

      <section className="card">
        <div className="row">
          <div>
            <b>Smart Shuffle</b>
            <p className="muted">
              参加者をA・B・Cへ均等に配布します。
              過去のMissionも考慮します。
            </p>
          </div>

          <button
            className="btn primary"
            onClick={createDrop}
            disabled={loading}
          >
            {loading
              ? '配布中...'
              : '🔥 Dropを配布'}
          </button>
        </div>

        {message && (
          <p
            style={{
              color: '#148558',
              fontWeight: 800,
              marginTop: 16,
            }}
          >
            ✓ {message}
          </p>
        )}

        {error && (
          <p
            style={{
              color: '#d33',
              fontWeight: 800,
              marginTop: 16,
            }}
          >
            エラー：{error}
          </p>
        )}
      </section>
    </main>
  )
}