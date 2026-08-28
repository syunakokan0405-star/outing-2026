'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type MissionForm = {
  title: string
  difficulty: 'easy' | 'normal' | 'hard'
  points: number
  required_mentions: number
}

type AssignmentRow = {
  id: string
  first_cleared_at: string | null
}

type MissionRow = {
  id: string
  slot: string
  title: string
  difficulty: string
  points: number
  required_mentions: number
  mission_assignments?: AssignmentRow[]
}

type DropRow = {
  id: string
  drop_number: number
  title: string | null
  status: string
  published_at: string | null
  created_at: string
  missions?: MissionRow[]
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

  const [drops, setDrops] = useState<DropRow[]>([])

  const [creating, setCreating] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [busyDropId, setBusyDropId] = useState<string | null>(null)

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

  async function loadDrops() {
    if (!eventId) {
      setError('EVENT IDが設定されていません。')
      setHistoryLoading(false)
      return
    }

    setHistoryLoading(true)

    const { data, error: loadError } = await supabase
      .from('mission_drops')
      .select(`
        id,
        drop_number,
        title,
        status,
        published_at,
        created_at,
        missions (
          id,
          slot,
          title,
          difficulty,
          points,
          required_mentions,
          mission_assignments (
            id,
            first_cleared_at
          )
        )
      `)
      .eq('event_id', eventId)
      .order('drop_number', { ascending: false })

    if (loadError) {
      setError(loadError.message)
      setHistoryLoading(false)
      return
    }

    setDrops((data ?? []) as unknown as DropRow[])
    setHistoryLoading(false)
  }

  useEffect(() => {
    void loadDrops()
  }, [])

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

    setCreating(true)

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

      setMessage(`Mission Dropを配布しました。Drop ID: ${data}`)
      await loadDrops()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Mission Dropの配布に失敗しました。'
      )
    } finally {
      setCreating(false)
    }
  }

  async function toggleDropStatus(drop: DropRow) {
    const nextStatus =
      drop.status === 'published'
        ? 'draft'
        : 'published'

    const actionLabel =
      nextStatus === 'published'
        ? '再公開'
        : '停止'

    const confirmed = window.confirm(
      `Drop #${drop.drop_number} を${actionLabel}しますか？`
    )

    if (!confirmed) return

    setBusyDropId(drop.id)
    setError('')
    setMessage('')

    const { error: rpcError } = await supabase.rpc(
      'admin_set_mission_drop_status',
      {
        p_drop_id: drop.id,
        p_status: nextStatus,
      }
    )

    if (rpcError) {
      setError(rpcError.message)
      setBusyDropId(null)
      return
    }

    setMessage(
      `Drop #${drop.drop_number} を${actionLabel}しました。`
    )

    setBusyDropId(null)
    await loadDrops()
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
        <h1>Mission Drop管理</h1>
        <p className="muted">
          3つのMissionを作成し、参加者へSmart Shuffleで均等に配布します。
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

            <label>推奨メンション人数</label>
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
            onClick={() => void createDrop()}
            disabled={creating}
          >
            {creating
              ? '配布中...'
              : '🔥 Dropを配布'}
          </button>
        </div>
      </section>

      <section>
        <h2>過去Drop</h2>
      </section>

      {historyLoading ? (
        <section className="card">
          <b>読み込み中...</b>
        </section>
      ) : drops.length === 0 ? (
        <section className="card">
          <p className="muted">
            まだMission Dropはありません。
          </p>
        </section>
      ) : (
        <div className="grid">
          {drops.map((drop) => {
            const dropAssignments =
              drop.missions?.reduce(
                (total, mission) =>
                  total +
                  (mission.mission_assignments?.length ?? 0),
                0
              ) ?? 0

            const dropCleared =
              drop.missions?.reduce(
                (total, mission) =>
                  total +
                  (
                    mission.mission_assignments?.filter(
                      (assignment) =>
                        Boolean(assignment.first_cleared_at)
                    ).length ?? 0
                  ),
                0
              ) ?? 0

            const clearRate =
              dropAssignments > 0
                ? Math.round(
                    (dropCleared / dropAssignments) * 100
                  )
                : 0

            return (
              <section className="card" key={drop.id}>
                <div className="row">
                  <div>
                    <h2>
                      Drop #{drop.drop_number}
                    </h2>

                    <p className="muted">
                      状態：
                      {drop.status === 'published'
                        ? '公開中'
                        : '停止中'}
                      {' / '}
                      CLEAR {dropCleared}/{dropAssignments}
                      {' '}
                      ({clearRate}%)
                    </p>
                  </div>

                  <button
                    className={
                      drop.status === 'published'
                        ? 'btn outline'
                        : 'btn primary'
                    }
                    onClick={() =>
                      void toggleDropStatus(drop)
                    }
                    disabled={busyDropId === drop.id}
                  >
                    {busyDropId === drop.id
                      ? '処理中...'
                      : drop.status === 'published'
                        ? '停止'
                        : '再公開'}
                  </button>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'repeat(auto-fit,minmax(220px,1fr))',
                    gap: 10,
                    marginTop: 12,
                  }}
                >
                  {(drop.missions ?? [])
                    .slice()
                    .sort((a, b) =>
                      a.slot.localeCompare(b.slot)
                    )
                    .map((mission) => {
                      const assigned =
                        mission.mission_assignments?.length ?? 0

                      const cleared =
                        mission.mission_assignments?.filter(
                          (assignment) =>
                            Boolean(
                              assignment.first_cleared_at
                            )
                        ).length ?? 0

                      return (
                        <div
                          className="card"
                          key={mission.id}
                        >
                          <b>
                            Mission {mission.slot}
                          </b>

                          <h3>{mission.title}</h3>

                          <p className="muted">
                            {mission.difficulty}
                            {' / '}
                            {mission.points}pt
                          </p>

                          <p className="muted">
                            配布 {assigned}人
                            {' / '}
                            CLEAR {cleared}人
                          </p>
                        </div>
                      )
                    })}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </main>
  )
}