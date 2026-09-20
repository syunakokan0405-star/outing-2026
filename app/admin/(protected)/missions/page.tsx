'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type MissionForm = {
  title: string
  difficulty: 'easy' | 'normal' | 'hard'
  points: number
  required_mentions: number
}

type MissionImage = {
  file: File | null
  previewUrl: string | null
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

  const [missionImages, setMissionImages] = useState<MissionImage[]>(
    initialMissions.map(() => ({
      file: null,
      previewUrl: null,
    }))
  )

  const [drops, setDrops] = useState<DropRow[]>([])

  const [creating, setCreating] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [busyDropId, setBusyDropId] = useState<string | null>(null)
  const [editingDropId, setEditingDropId] = useState<string | null>(null)
  const [draftDropNumber, setDraftDropNumber] = useState('')

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

  function selectMissionImage(index: number, file: File | null) {
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setError('画像ファイルを選択してください。')
      return
    }

    setError('')

    setMissionImages((current) =>
      current.map((image, i) => {
        if (i !== index) return image

        if (image.previewUrl) {
          URL.revokeObjectURL(image.previewUrl)
        }

        return {
          file,
          previewUrl: URL.createObjectURL(file),
        }
      })
    )
  }

  function removeMissionImage(index: number) {
    setMissionImages((current) =>
      current.map((image, i) => {
        if (i !== index) return image

        if (image.previewUrl) {
          URL.revokeObjectURL(image.previewUrl)
        }

        return {
          file: null,
          previewUrl: null,
        }
      })
    )
  }

  async function uploadMissionImage(
    index: number,
    file: File,
    uploadKey: string
  ) {
    if (!eventId) {
      throw new Error('EVENT IDが設定されていません。')
    }

    const extension =
      file.name.split('.').pop()?.toLowerCase() ||
      file.type.split('/').pop() ||
      'jpg'

    const slot = String.fromCharCode(65 + index)

    const path =
      `mission-backgrounds/${eventId}/${uploadKey}-${slot}.${extension}`

    const { error: uploadError } = await supabase.storage
      .from('outing-photos')
      .upload(path, file, {
        upsert: false,
        contentType: file.type || undefined,
        cacheControl: '3600',
      })

    if (uploadError) {
      throw uploadError
    }

    return path
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
      const uploadKey =
        `${Date.now()}-${crypto.randomUUID()}`

      const missionsWithImages = await Promise.all(
        missions.map(async (mission, index) => {
          const file = missionImages[index]?.file

          const imagePath = file
            ? await uploadMissionImage(index, file, uploadKey)
            : null

          return {
            ...mission,
            image_path: imagePath,
          }
        })
      )

      const { data, error: rpcError } = await supabase.rpc(
        'create_mission_drop',
        {
          p_event_id: eventId,
          p_missions: missionsWithImages,
        }
      )

      if (rpcError) {
        throw rpcError
      }

      setMessage(`Mission Dropを配布しました。Drop ID: ${data}`)

      setMissionImages((current) => {
        current.forEach((image) => {
          if (image.previewUrl) {
            URL.revokeObjectURL(image.previewUrl)
          }
        })

        return initialMissions.map(() => ({
          file: null,
          previewUrl: null,
        }))
      })

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

  function startEditingDropNumber(drop: DropRow) {
    setMessage('')
    setError('')
    setEditingDropId(drop.id)
    setDraftDropNumber(String(drop.drop_number))
  }

  function cancelEditingDropNumber() {
    setEditingDropId(null)
    setDraftDropNumber('')
  }

  async function saveDropNumber(drop: DropRow) {
    const nextDropNumber = Number(draftDropNumber)

    setMessage('')
    setError('')

    if (!Number.isInteger(nextDropNumber) || nextDropNumber < 1) {
      setError('Drop No.は1以上の整数で入力してください。')
      return
    }

    if (nextDropNumber === drop.drop_number) {
      cancelEditingDropNumber()
      return
    }

    const confirmed = window.confirm(
      `Drop #${drop.drop_number} を Drop #${nextDropNumber} に変更しますか？\nMissionの配布内容や投稿データは変更されません。`
    )

    if (!confirmed) return

    setBusyDropId(drop.id)

    const { error: rpcError } = await supabase.rpc(
      'admin_set_mission_drop_number',
      {
        p_drop_id: drop.id,
        p_drop_number: nextDropNumber,
      }
    )

    if (rpcError) {
      setError(rpcError.message)
      setBusyDropId(null)
      return
    }

    setMessage(
      `Drop #${drop.drop_number} を Drop #${nextDropNumber} に変更しました。`
    )
    setEditingDropId(null)
    setDraftDropNumber('')
    setBusyDropId(null)
    await loadDrops()
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

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box' as const,
    padding: '11px 12px',
    marginTop: 6,
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,.10)',
    background: 'rgba(255,255,255,.045)',
    color: '#fff',
    outline: 'none',
    font: 'inherit',
  }

  const cardStyle = {
    borderRadius: 18,
    border: '1px solid rgba(255,255,255,.075)',
    background: 'rgba(255,255,255,.035)',
  }

  return (
    <main
      className="outingSans"
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg,#0b0c12 0%,#11131b 100%)',
        color: '#fff',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 1180,
          margin: '0 auto',
          padding: '36px 24px 64px',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ marginBottom: 34 }}>
          <a
            href="/admin"
            style={{
              color: 'rgba(255,255,255,.45)',
              textDecoration: 'none',
              fontSize: 11,
            }}
          >
            ← Admin Dashboard
          </a>

          <p
            className="outingSerifEn"
            style={{
              margin: '22px 0 0',
              color: 'rgba(255,255,255,.38)',
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '.18em',
            }}
          >
            OUTING 2026 / ADMIN
          </p>

          <h1
            className="outingSerifEn"
            style={{
              margin: '7px 0 0',
              fontSize: 34,
              lineHeight: 1,
              fontWeight: 500,
              letterSpacing: '.08em',
            }}
          >
            MISSION DROP
          </h1>

          <p
            style={{
              margin: '12px 0 0',
              color: 'rgba(255,255,255,.44)',
              fontSize: 12,
              lineHeight: 1.7,
            }}
          >
            3つのMissionを作成し、Smart Shuffleで参加者へ均等に配布します。
          </p>
        </div>

        {error && (
          <div
            style={{
              ...cardStyle,
              marginBottom: 14,
              padding: '14px 16px',
              borderColor: 'rgba(248,113,113,.22)',
              background: 'rgba(248,113,113,.07)',
              color: '#fca5a5',
              fontSize: 12,
            }}
          >
            エラー：{error}
          </div>
        )}

        {message && (
          <div
            style={{
              ...cardStyle,
              marginBottom: 14,
              padding: '14px 16px',
              borderColor: 'rgba(74,222,128,.20)',
              background: 'rgba(74,222,128,.06)',
              color: '#86efac',
              fontSize: 12,
            }}
          >
            {message}
          </div>
        )}

        <section style={{ marginBottom: 30 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'end',
              gap: 16,
              marginBottom: 14,
            }}
          >
            <div>
              <p
                className="outingSerifEn"
                style={{
                  margin: 0,
                  color: 'rgba(255,255,255,.34)',
                  fontSize: 10,
                  letterSpacing: '.16em',
                }}
              >
                NEW DROP
              </p>
              <h2 style={{ margin: '5px 0 0', fontSize: 18 }}>
                Mission設定
              </h2>
            </div>

            <span
              style={{
                color: '#b9a4ff',
                fontSize: 10,
                letterSpacing: '.08em',
              }}
            >
              3 MISSIONS
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))',
              gap: 12,
            }}
          >
            {missions.map((mission, index) => (
              <div key={index} style={{ ...cardStyle, padding: 20 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginBottom: 20,
                  }}
                >
                  <div>
                    <p
                      className="outingSerifEn"
                      style={{
                        margin: 0,
                        color: 'rgba(255,255,255,.34)',
                        fontSize: 9,
                        letterSpacing: '.14em',
                      }}
                    >
                      MISSION
                    </p>
                    <h3
                      className="outingSerifEn"
                      style={{
                        margin: '3px 0 0',
                        fontSize: 24,
                        fontWeight: 500,
                      }}
                    >
                      {String.fromCharCode(65 + index)}
                    </h3>
                  </div>

                  <div
                    style={{
                      padding: '6px 9px',
                      borderRadius: 999,
                      background: 'rgba(139,92,246,.10)',
                      border: '1px solid rgba(167,139,250,.14)',
                      color: '#c4b5fd',
                      fontSize: 9,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                    }}
                  >
                    {mission.difficulty}
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <div
                    style={{
                      position: 'relative',
                      aspectRatio: '16 / 9',
                      overflow: 'hidden',
                      borderRadius: 14,
                      border: '1px solid rgba(255,255,255,.08)',
                      background: 'rgba(0,0,0,.18)',
                    }}
                  >
                    <img
                      src={
                        missionImages[index]?.previewUrl ??
                        '/mission-default.jpg'
                      }
                      alt={`Mission ${String.fromCharCode(65 + index)} preview`}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        display: 'block',
                        opacity: missionImages[index]?.previewUrl ? 1 : 0.58,
                      }}
                    />

                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        background:
                          'linear-gradient(180deg,transparent 45%,rgba(0,0,0,.58) 100%)',
                        pointerEvents: 'none',
                      }}
                    />

                    <label
                      style={{
                        position: 'absolute',
                        left: 10,
                        bottom: 10,
                        padding: '8px 11px',
                        borderRadius: 10,
                        background: 'rgba(12,13,19,.78)',
                        border: '1px solid rgba(255,255,255,.14)',
                        color: '#fff',
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: creating ? 'default' : 'pointer',
                        backdropFilter: 'blur(10px)',
                      }}
                    >
                      {missionImages[index]?.file
                        ? '画像を変更'
                        : '画像を選択'}
                      <input
                        type="file"
                        accept="image/*"
                        disabled={creating}
                        onChange={(e) =>
                          selectMissionImage(
                            index,
                            e.target.files?.[0] ?? null
                          )
                        }
                        style={{ display: 'none' }}
                      />
                    </label>

                    {missionImages[index]?.file && (
                      <button
                        type="button"
                        disabled={creating}
                        onClick={() => removeMissionImage(index)}
                        style={{
                          position: 'absolute',
                          right: 10,
                          bottom: 10,
                          padding: '8px 10px',
                          borderRadius: 10,
                          border: '1px solid rgba(255,255,255,.12)',
                          background: 'rgba(12,13,19,.72)',
                          color: 'rgba(255,255,255,.72)',
                          fontSize: 10,
                          cursor: creating ? 'default' : 'pointer',
                        }}
                      >
                        既定画像
                      </button>
                    )}
                  </div>

                  <p
                    style={{
                      margin: '7px 0 0',
                      color: 'rgba(255,255,255,.32)',
                      fontSize: 9,
                      lineHeight: 1.5,
                    }}
                  >
                    参加者のMissionカードに表示されます。未選択時は既定画像。
                  </p>
                </div>

                <label style={{ fontSize: 11, color: 'rgba(255,255,255,.62)' }}>
                  Mission名
                  <input
                    value={mission.title}
                    onChange={(e) =>
                      updateMission(index, 'title', e.target.value)
                    }
                    style={inputStyle}
                  />
                </label>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 10,
                    marginTop: 14,
                  }}
                >
                  <label style={{ fontSize: 11, color: 'rgba(255,255,255,.62)' }}>
                    難易度
                    <select
                      value={mission.difficulty}
                      onChange={(e) =>
                        updateMission(index, 'difficulty', e.target.value)
                      }
                      style={inputStyle}
                    >
                      <option value="easy" style={{ color: '#111' }}>Easy</option>
                      <option value="normal" style={{ color: '#111' }}>Normal</option>
                      <option value="hard" style={{ color: '#111' }}>Hard</option>
                    </select>
                  </label>

                  <label style={{ fontSize: 11, color: 'rgba(255,255,255,.62)' }}>
                    得点
                    <input
                      type="number"
                      min="0"
                      value={mission.points}
                      onChange={(e) =>
                        updateMission(index, 'points', Number(e.target.value))
                      }
                      style={inputStyle}
                    />
                  </label>
                </div>

                <label
                  style={{
                    display: 'block',
                    marginTop: 14,
                    fontSize: 11,
                    color: 'rgba(255,255,255,.62)',
                  }}
                >
                  推奨メンション人数
                  <input
                    type="number"
                    min="0"
                    value={mission.required_mentions}
                    onChange={(e) =>
                      updateMission(
                        index,
                        'required_mentions',
                        Number(e.target.value),
                      )
                    }
                    style={inputStyle}
                  />
                </label>
              </div>
            ))}
          </div>
        </section>

        <section
          style={{
            ...cardStyle,
            padding: 20,
            marginBottom: 38,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 18,
          }}
        >
          <div>
            <p
              className="outingSerifEn"
              style={{
                margin: 0,
                color: '#b9a4ff',
                fontSize: 10,
                letterSpacing: '.14em',
              }}
            >
              SMART SHUFFLE
            </p>
            <h3 style={{ margin: '5px 0 0', fontSize: 16 }}>
              参加者へMissionを配布
            </h3>
            <p
              style={{
                margin: '6px 0 0',
                color: 'rgba(255,255,255,.40)',
                fontSize: 11,
              }}
            >
              A・B・Cへ均等に配布し、過去のMissionも考慮します。
            </p>
          </div>

          <button
            onClick={() => void createDrop()}
            disabled={creating}
            style={{
              minWidth: 160,
              padding: '12px 18px',
              border: 0,
              borderRadius: 12,
              background: creating ? 'rgba(139,92,246,.35)' : '#7c3aed',
              color: '#fff',
              fontWeight: 700,
              cursor: creating ? 'default' : 'pointer',
            }}
          >
            {creating ? '配布中...' : 'Dropを配布'}
          </button>
        </section>

        <section>
          <div style={{ marginBottom: 14 }}>
            <p
              className="outingSerifEn"
              style={{
                margin: 0,
                color: 'rgba(255,255,255,.34)',
                fontSize: 10,
                letterSpacing: '.16em',
              }}
            >
              DROP HISTORY
            </p>
            <h2 style={{ margin: '5px 0 0', fontSize: 18 }}>
              過去Drop
            </h2>
          </div>

          {historyLoading ? (
            <div style={{ ...cardStyle, padding: 20, color: 'rgba(255,255,255,.48)' }}>
              読み込み中...
            </div>
          ) : drops.length === 0 ? (
            <div style={{ ...cardStyle, padding: 20, color: 'rgba(255,255,255,.48)' }}>
              まだMission Dropはありません。
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {drops.map((drop) => {
                const dropAssignments =
                  drop.missions?.reduce(
                    (total, mission) =>
                      total + (mission.mission_assignments?.length ?? 0),
                    0,
                  ) ?? 0

                const dropCleared =
                  drop.missions?.reduce(
                    (total, mission) =>
                      total +
                      (mission.mission_assignments?.filter((assignment) =>
                        Boolean(assignment.first_cleared_at),
                      ).length ?? 0),
                    0,
                  ) ?? 0

                const clearRate =
                  dropAssignments > 0
                    ? Math.round((dropCleared / dropAssignments) * 100)
                    : 0

                const published = drop.status === 'published'

                return (
                  <div key={drop.id} style={{ ...cardStyle, padding: 20 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 14,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div>
                          <p
                            className="outingSerifEn"
                            style={{
                              margin: 0,
                              color: 'rgba(255,255,255,.34)',
                              fontSize: 9,
                              letterSpacing: '.14em',
                            }}
                          >
                            DROP
                          </p>
                          {editingDropId === drop.id ? (
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 7,
                                marginTop: 3,
                                flexWrap: 'wrap',
                              }}
                            >
                              <span
                                className="outingSerifEn"
                                style={{ fontSize: 22, lineHeight: 1 }}
                              >
                                #
                              </span>
                              <input
                                type="number"
                                min="1"
                                step="1"
                                inputMode="numeric"
                                value={draftDropNumber}
                                disabled={busyDropId === drop.id}
                                onChange={(e) => setDraftDropNumber(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    void saveDropNumber(drop)
                                  }
                                  if (e.key === 'Escape') {
                                    cancelEditingDropNumber()
                                  }
                                }}
                                autoFocus
                                aria-label={`Drop ${drop.drop_number} の新しい番号`}
                                style={{
                                  width: 72,
                                  padding: '6px 8px',
                                  borderRadius: 8,
                                  border: '1px solid rgba(167,139,250,.28)',
                                  background: 'rgba(139,92,246,.10)',
                                  color: '#fff',
                                  outline: 'none',
                                  fontSize: 16,
                                  fontWeight: 700,
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => void saveDropNumber(drop)}
                                disabled={busyDropId === drop.id}
                                style={{
                                  padding: '6px 9px',
                                  borderRadius: 8,
                                  border: '1px solid rgba(167,139,250,.22)',
                                  background: 'rgba(139,92,246,.16)',
                                  color: '#c4b5fd',
                                  fontSize: 9,
                                  fontWeight: 700,
                                  cursor: busyDropId === drop.id ? 'default' : 'pointer',
                                }}
                              >
                                {busyDropId === drop.id ? '保存中...' : '保存'}
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditingDropNumber}
                                disabled={busyDropId === drop.id}
                                style={{
                                  padding: '6px 8px',
                                  borderRadius: 8,
                                  border: '1px solid rgba(255,255,255,.10)',
                                  background: 'rgba(255,255,255,.04)',
                                  color: 'rgba(255,255,255,.58)',
                                  fontSize: 9,
                                  cursor: busyDropId === drop.id ? 'default' : 'pointer',
                                }}
                              >
                                キャンセル
                              </button>
                            </div>
                          ) : (
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 9,
                                marginTop: 2,
                              }}
                            >
                              <div
                                className="outingSerifEn"
                                style={{ fontSize: 27, lineHeight: 1.1 }}
                              >
                                #{String(drop.drop_number).padStart(2, '0')}
                              </div>
                              <button
                                type="button"
                                onClick={() => startEditingDropNumber(drop)}
                                disabled={busyDropId === drop.id || editingDropId !== null}
                                style={{
                                  padding: '5px 8px',
                                  borderRadius: 8,
                                  border: '1px solid rgba(255,255,255,.10)',
                                  background: 'rgba(255,255,255,.04)',
                                  color: 'rgba(255,255,255,.58)',
                                  fontSize: 9,
                                  cursor:
                                    busyDropId === drop.id || editingDropId !== null
                                      ? 'default'
                                      : 'pointer',
                                }}
                              >
                                番号変更
                              </button>
                            </div>
                          )}
                        </div>

                        <span
                          style={{
                            padding: '6px 9px',
                            borderRadius: 999,
                            background: published
                              ? 'rgba(34,197,94,.08)'
                              : 'rgba(255,255,255,.05)',
                            border: published
                              ? '1px solid rgba(34,197,94,.18)'
                              : '1px solid rgba(255,255,255,.08)',
                            color: published ? '#86efac' : 'rgba(255,255,255,.48)',
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: '.08em',
                          }}
                        >
                          {published ? 'PUBLISHED' : 'STOPPED'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 22, fontWeight: 700 }}>
                            {clearRate}%
                          </div>
                          <div
                            style={{
                              marginTop: 2,
                              color: 'rgba(255,255,255,.35)',
                              fontSize: 9,
                              letterSpacing: '.08em',
                            }}
                          >
                            CLEAR {dropCleared}/{dropAssignments}
                          </div>
                        </div>

                        <button
                          onClick={() => void toggleDropStatus(drop)}
                          disabled={busyDropId === drop.id}
                          style={{
                            padding: '9px 13px',
                            borderRadius: 10,
                            border: published
                              ? '1px solid rgba(255,255,255,.12)'
                              : '1px solid rgba(167,139,250,.18)',
                            background: published
                              ? 'rgba(255,255,255,.04)'
                              : 'rgba(139,92,246,.12)',
                            color: published ? '#fff' : '#c4b5fd',
                            cursor: busyDropId === drop.id ? 'default' : 'pointer',
                          }}
                        >
                          {busyDropId === drop.id
                            ? '処理中...'
                            : published
                              ? '停止'
                              : '再公開'}
                        </button>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
                        gap: 10,
                        marginTop: 18,
                      }}
                    >
                      {(drop.missions ?? [])
                        .slice()
                        .sort((a, b) => a.slot.localeCompare(b.slot))
                        .map((mission) => {
                          const assigned =
                            mission.mission_assignments?.length ?? 0

                          const cleared =
                            mission.mission_assignments?.filter((assignment) =>
                              Boolean(assignment.first_cleared_at),
                            ).length ?? 0

                          return (
                            <div
                              key={mission.id}
                              style={{
                                padding: 15,
                                borderRadius: 14,
                                border: '1px solid rgba(255,255,255,.06)',
                                background: 'rgba(0,0,0,.12)',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  gap: 10,
                                  alignItems: 'center',
                                }}
                              >
                                <span
                                  className="outingSerifEn"
                                  style={{
                                    color: '#b9a4ff',
                                    fontSize: 12,
                                    letterSpacing: '.08em',
                                  }}
                                >
                                  MISSION {mission.slot}
                                </span>

                                <span
                                  style={{
                                    color: 'rgba(255,255,255,.38)',
                                    fontSize: 9,
                                    textTransform: 'uppercase',
                                  }}
                                >
                                  {mission.difficulty}
                                </span>
                              </div>

                              <h3
                                className="outingSerifJa"
                                style={{
                                  margin: '9px 0 0',
                                  fontSize: 15,
                                  fontWeight: 400,
                                }}
                              >
                                {mission.title}
                              </h3>

                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  gap: 12,
                                  marginTop: 13,
                                  color: 'rgba(255,255,255,.44)',
                                  fontSize: 10,
                                }}
                              >
                                <span>{mission.points} PT</span>
                                <span>
                                  配布 {assigned} / CLEAR {cleared}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
