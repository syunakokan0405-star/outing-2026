'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type GuideSection = {
  id: string
  section_type: string
  title: string
  body: string
  sort_order: number
}

export default function AdminGuide() {
  const supabase = useMemo(() => createClient(), [])

  const [sections, setSections] = useState<GuideSection[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const eventId = process.env.NEXT_PUBLIC_EVENT_ID

  async function loadSections() {
    if (!eventId) {
      setError('EVENT IDが設定されていません。')
      setLoading(false)
      return
    }

    setError('')

    const { data, error: loadError } = await supabase
      .from('guide_sections')
      .select('id,section_type,title,body,sort_order')
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true })

    if (loadError) {
      setError(loadError.message)
      setLoading(false)
      return
    }

    setSections((data ?? []) as GuideSection[])
    setLoading(false)
  }

  useEffect(() => {
    void loadSections()
  }, [])

  function updateSection(
    id: string,
    field: keyof GuideSection,
    value: string | number
  ) {
    setSections((current) =>
      current.map((section) =>
        section.id === id
          ? { ...section, [field]: value }
          : section
      )
    )
  }

  function addSection() {
    const tempId = `new-${crypto.randomUUID()}`

    setSections((current) => [
      ...current,
      {
        id: tempId,
        section_type: 'other',
        title: '',
        body: '',
        sort_order: current.length + 1,
      },
    ])
  }

  async function saveSection(section: GuideSection) {
    if (!eventId) return

    if (!section.title.trim()) {
      setError('タイトルを入力してください。')
      return
    }

    setSaving(section.id)
    setError('')
    setMessage('')

    const isNew = section.id.startsWith('new-')

    const { data, error: saveError } = await supabase.rpc(
      'upsert_guide_section',
      {
        p_event_id: eventId,
        p_section_id: isNew ? null : section.id,
        p_section_type: section.section_type,
        p_title: section.title,
        p_body: section.body,
        p_sort_order: section.sort_order,
      }
    )

    if (saveError) {
      setError(saveError.message)
      setSaving(null)
      return
    }

    setMessage(`「${section.title}」を保存しました。`)
    setSaving(null)

    await loadSections()
  }

  async function deleteSection(section: GuideSection) {
    if (!eventId) return

    if (section.id.startsWith('new-')) {
      setSections((current) =>
        current.filter((item) => item.id !== section.id)
      )
      return
    }

    const confirmed = window.confirm(
      `「${section.title}」を削除しますか？`
    )

    if (!confirmed) return

    setSaving(section.id)
    setError('')
    setMessage('')

    const { error: deleteError } = await supabase.rpc(
      'delete_guide_section',
      {
        p_event_id: eventId,
        p_section_id: section.id,
      }
    )

    if (deleteError) {
      setError(deleteError.message)
      setSaving(null)
      return
    }

    setMessage('Guideセクションを削除しました。')
    setSaving(null)

    await loadSections()
  }

  return (
    <main
      style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}
      className="grid"
    >
      <div>
        <Link className="backLink" href="/admin">
          ← Dashboard
        </Link>

        <div className="brand" style={{ marginTop: 12 }}>
          OUTING 2026 ADMIN
        </div>

        <h1>Guide編集</h1>

        <p className="muted">
          参加者に表示する案内を追加・編集できます。
        </p>
      </div>

      {error && (
        <section className="card">
          <b style={{ color: '#d33' }}>エラー：{error}</b>
        </section>
      )}

      {message && (
        <section className="card">
          <b style={{ color: '#148558' }}>✓ {message}</b>
        </section>
      )}

      {loading ? (
        <section className="card">
          <b>読み込み中...</b>
        </section>
      ) : (
        <>
          {sections.map((section) => (
            <section className="card" key={section.id}>
<label>
  <b>カテゴリ</b>
</label>

<select
  value={section.section_type}
  onChange={(e) =>
    updateSection(
      section.id,
      'section_type',
      e.target.value
    )
  }
  style={{
    width: '100%',
    padding: 10,
    margin: '6px 0 12px',
  }}
>
  <option value="schedule">📅 Schedule</option>
  <option value="packing">🎒 持ち物</option>
  <option value="rules">⚠️ 注意事項</option>
  <option value="place">📍 施設・集合場所</option>
  <option value="groups">👥 班分け</option>
  <option value="other">📖 しおり全文・その他</option>
</select>
              <label>
                <b>タイトル</b>
              </label>

              <input
                value={section.title}
                onChange={(e) =>
                  updateSection(
                    section.id,
                    'title',
                    e.target.value
                  )
                }
                style={{
                  width: '100%',
                  padding: 10,
                  margin: '6px 0 12px',
                }}
                placeholder="例：集合時間"
              />

              <label>
                <b>本文</b>
              </label>

              <textarea
                rows={6}
                value={section.body}
                onChange={(e) =>
                  updateSection(
                    section.id,
                    'body',
                    e.target.value
                  )
                }
                style={{
                  width: '100%',
                  padding: 10,
                  margin: '6px 0 12px',
                }}
                placeholder="参加者への案内を入力"
              />

              <label>
                <b>表示順</b>
              </label>

              <input
                type="number"
                min="0"
                value={section.sort_order}
                onChange={(e) =>
                  updateSection(
                    section.id,
                    'sort_order',
                    Number(e.target.value)
                  )
                }
                style={{
                  width: 100,
                  padding: 10,
                  margin: '6px 0 12px',
                }}
              />

              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <button
                  className="btn primary"
                  onClick={() => void saveSection(section)}
                  disabled={saving === section.id}
                >
                  {saving === section.id
                    ? '保存中...'
                    : '保存'}
                </button>

                <button
                  className="btn outline"
                  style={{ color: '#d33' }}
                  onClick={() => void deleteSection(section)}
                  disabled={saving === section.id}
                >
                  削除
                </button>
              </div>
            </section>
          ))}

          <button
            className="btn outline"
            onClick={addSection}
          >
            ＋ セクションを追加
          </button>
        </>
      )}
    </main>
  )
}