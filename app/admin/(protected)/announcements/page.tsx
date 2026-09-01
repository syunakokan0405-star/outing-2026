'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Announcement = {
  id: string
  title: string
  body: string
  is_published: boolean
  created_at: string
  updated_at: string
  published_at: string | null
}

export default function AdminAnnouncements() {
  const supabase = useMemo(() => createClient(), [])
  const eventId = process.env.NEXT_PUBLIC_EVENT_ID

  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const loadAnnouncements = useCallback(async () => {
    if (!eventId) {
      setError('EVENT IDが設定されていません。')
      setLoading(false)
      return
    }

    setError('')

    const { data, error: loadError } = await supabase
      .from('announcements')
      .select(`
        id,
        title,
        body,
        is_published,
        created_at,
        updated_at,
        published_at
      `)
      .eq('event_id', eventId)
      .order('created_at', {
        ascending: false,
      })

    if (loadError) {
      setError(loadError.message)
      setLoading(false)
      return
    }

    setAnnouncements((data ?? []) as Announcement[])
    setLoading(false)
  }, [eventId, supabase])

  useEffect(() => {
    void loadAnnouncements()
  }, [loadAnnouncements])

  function addAnnouncement() {
    const tempId = `new-${crypto.randomUUID()}`

    setAnnouncements((current) => [
      {
        id: tempId,
        title: '',
        body: '',
        is_published: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        published_at: null,
      },
      ...current,
    ])
  }

  function updateAnnouncement(
    id: string,
    field: 'title' | 'body',
    value: string,
  ) {
    setAnnouncements((current) =>
      current.map((announcement) =>
        announcement.id === id
          ? {
              ...announcement,
              [field]: value,
            }
          : announcement,
      ),
    )
  }

  async function saveAnnouncement(
    announcement: Announcement,
  ) {
    if (!eventId) return

    if (!announcement.title.trim()) {
      setError('タイトルを入力してください。')
      return
    }

    if (!announcement.body.trim()) {
      setError('本文を入力してください。')
      return
    }

    setSaving(announcement.id)
    setError('')
    setMessage('')

    const isNew =
      announcement.id.startsWith('new-')

    const { error: saveError } =
      await supabase.rpc(
        'admin_save_announcement',
        {
          p_event_id: eventId,
          p_announcement_id: isNew
            ? null
            : announcement.id,
          p_title: announcement.title,
          p_body: announcement.body,
        },
      )

    if (saveError) {
      setError(saveError.message)
      setSaving(null)
      return
    }

    setMessage(
      `「${announcement.title}」を保存しました。`,
    )

    setSaving(null)
    await loadAnnouncements()
  }

  async function togglePublished(
    announcement: Announcement,
  ) {
    if (announcement.id.startsWith('new-')) {
      setError(
        '先にお知らせを保存してください。',
      )
      return
    }

    setSaving(announcement.id)
    setError('')
    setMessage('')

    const nextPublished =
      !announcement.is_published

    const { error: publishError } =
      await supabase.rpc(
        'admin_set_announcement_published',
        {
          p_announcement_id:
            announcement.id,
          p_published: nextPublished,
        },
      )

    if (publishError) {
      setError(publishError.message)
      setSaving(null)
      return
    }

    setMessage(
      nextPublished
        ? `「${announcement.title}」を公開しました。`
        : `「${announcement.title}」を非公開にしました。`,
    )

    setSaving(null)
    await loadAnnouncements()
  }

  function removeUnsaved(
    announcement: Announcement,
  ) {
    if (!announcement.id.startsWith('new-')) {
      return
    }

    setAnnouncements((current) =>
      current.filter(
        (item) =>
          item.id !== announcement.id,
      ),
    )
  }

  return (
    <main
      className="grid"
      style={{
        maxWidth: 900,
        margin: '0 auto',
        padding: 24,
      }}
    >
      <div>
        <Link
          className="backLink"
          href="/admin"
        >
          ← Dashboard
        </Link>

        <div
          className="brand"
          style={{ marginTop: 12 }}
        >
          OUTING 2026 ADMIN
        </div>

        <h1>お知らせ管理</h1>

        <p className="muted">
          参加者ホームに表示するお知らせを管理します。
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

      <button
        type="button"
        className="btn primary"
        onClick={addAnnouncement}
      >
        ＋ 新しいお知らせ
      </button>

      {loading ? (
        <section className="card">
          <b>読み込み中...</b>
        </section>
      ) : announcements.length === 0 ? (
        <section className="card">
          <h2>お知らせはありません</h2>

          <p className="muted">
            「新しいお知らせ」から作成できます。
          </p>
        </section>
      ) : (
        announcements.map(
          (announcement) => (
            <section
              className="card"
              key={announcement.id}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent:
                    'space-between',
                  alignItems: 'center',
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <b>
                  {announcement.id.startsWith(
                    'new-',
                  )
                    ? '新規お知らせ'
                    : announcement.is_published
                      ? '📢 公開中'
                      : '下書き'}
                </b>

                {!announcement.id.startsWith(
                  'new-',
                ) && (
                  <span className="muted">
                    {announcement.is_published
                      ? '参加者ホームに表示中'
                      : '参加者には非表示'}
                  </span>
                )}
              </div>

              <label>
                <b>タイトル</b>
              </label>

              <input
                value={announcement.title}
                onChange={(event) =>
                  updateAnnouncement(
                    announcement.id,
                    'title',
                    event.target.value,
                  )
                }
                placeholder="例：集合時間について"
                maxLength={80}
                style={{
                  width: '100%',
                  padding: 10,
                  margin: '6px 0 16px',
                }}
              />

              <label>
                <b>本文</b>
              </label>

              <textarea
                rows={5}
                value={announcement.body}
                onChange={(event) =>
                  updateAnnouncement(
                    announcement.id,
                    'body',
                    event.target.value,
                  )
                }
                placeholder="参加者へのお知らせを入力"
                style={{
                  width: '100%',
                  padding: 10,
                  margin: '6px 0 16px',
                  resize: 'vertical',
                }}
              />

              {announcement.published_at && (
                <p className="muted">
                  公開日時：
                  {new Date(
                    announcement.published_at,
                  ).toLocaleString('ja-JP')}
                </p>
              )}

              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <button
                  type="button"
                  className="btn primary"
                  disabled={
                    saving === announcement.id
                  }
                  onClick={() =>
                    void saveAnnouncement(
                      announcement,
                    )
                  }
                >
                  {saving === announcement.id
                    ? '処理中...'
                    : '保存'}
                </button>

                {announcement.id.startsWith(
                  'new-',
                ) ? (
                  <button
                    type="button"
                    className="btn outline"
                    disabled={
                      saving === announcement.id
                    }
                    onClick={() =>
                      removeUnsaved(
                        announcement,
                      )
                    }
                  >
                    キャンセル
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn outline"
                    disabled={
                      saving === announcement.id
                    }
                    onClick={() =>
                      void togglePublished(
                        announcement,
                      )
                    }
                  >
                    {announcement.is_published
                      ? '非公開にする'
                      : '公開する'}
                  </button>
                )}
              </div>
            </section>
          ),
        )
      )}
    </main>
  )
}