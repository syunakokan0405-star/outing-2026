'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Award = {
  id: string
  name: string
  description: string | null
}

type PostRow = {
  id: string
  image_path: string
  created_at: string
  comment: string | null
  participant_id: string
  participants?: {
    name: string
  } | null
}

type WinnerRow = {
  award_id: string
  post_id: string
}

export default function AdminAwardsPage() {
  const supabase = useMemo(() => createClient(), [])
  const eventId = process.env.NEXT_PUBLIC_EVENT_ID

  const [awards, setAwards] = useState<Award[]>([])
  const [posts, setPosts] = useState<PostRow[]>([])
  const [winners, setWinners] = useState<WinnerRow[]>([])
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedAwardId, setSelectedAwardId] = useState('')

  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  async function load() {
    if (!eventId) {
      setError('EVENT IDが設定されていません。')
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    const [awardResult, postResult] = await Promise.all([
      supabase
        .from('awards')
        .select('id,name,description')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false }),

      supabase
        .from('posts')
        .select(`
          id,
          image_path,
          created_at,
          comment,
          participant_id,
          participants!posts_participant_id_fkey(name)
        `)
        .eq('event_id', eventId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
    ])

    if (awardResult.error) {
      setError(awardResult.error.message)
      setLoading(false)
      return
    }

    if (postResult.error) {
      setError(postResult.error.message)
      setLoading(false)
      return
    }

    const awardRows = (awardResult.data ?? []) as Award[]
    const postRows = (postResult.data ?? []) as unknown as PostRow[]

    setAwards(awardRows)
    setPosts(postRows)

    let nextSelectedAwardId = selectedAwardId

    if (
      !nextSelectedAwardId ||
      !awardRows.some((award) => award.id === nextSelectedAwardId)
    ) {
      nextSelectedAwardId = awardRows[0]?.id ?? ''
      setSelectedAwardId(nextSelectedAwardId)
    }

    if (awardRows.length > 0) {
      const { data: winnerData, error: winnerError } = await supabase
        .from('award_winners')
        .select('award_id,post_id')
        .in(
          'award_id',
          awardRows.map((award) => award.id)
        )

      if (winnerError) {
        setError(winnerError.message)
        setLoading(false)
        return
      }

      setWinners((winnerData ?? []) as WinnerRow[])
    } else {
      setWinners([])
    }

    const paths = postRows
      .map((post) => post.image_path)
      .filter(Boolean)

    if (paths.length > 0) {
      const { data: signedData } = await supabase.storage
        .from('outing-photos')
        .createSignedUrls(paths, 3600)

      const map: Record<string, string> = {}

      signedData?.forEach((item, index) => {
        if (item.signedUrl) {
          map[paths[index]] = item.signedUrl
        }
      })

      setSignedUrls(map)
    } else {
      setSignedUrls({})
    }

    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  async function createAward() {
    if (!eventId) return

    if (!name.trim()) {
      setError('Award名を入力してください。')
      return
    }

    setBusy(true)
    setError('')
    setMessage('')

    const { data, error: rpcError } = await supabase.rpc(
      'admin_create_award',
      {
        p_event_id: eventId,
        p_name: name.trim(),
        p_description: description.trim() || null,
      }
    )

    if (rpcError) {
      setError(rpcError.message)
      setBusy(false)
      return
    }

    setName('')
    setDescription('')
    setSelectedAwardId(String(data))
    setMessage('Awardを作成しました。')

    setBusy(false)
    await load()
  }

  async function editAward(award: Award) {
    const nextName = window.prompt(
      'Award名を編集',
      award.name
    )

    if (nextName === null) return

    const nextDescription = window.prompt(
      '説明を編集',
      award.description ?? ''
    )

    if (nextDescription === null) return

    if (!nextName.trim()) {
      setError('Award名を空欄にはできません。')
      return
    }

    setBusy(true)
    setError('')
    setMessage('')

    const { error: rpcError } = await supabase.rpc(
      'admin_update_award',
      {
        p_award_id: award.id,
        p_name: nextName.trim(),
        p_description: nextDescription.trim() || null,
      }
    )

    if (rpcError) {
      setError(rpcError.message)
      setBusy(false)
      return
    }

    setMessage('Awardを更新しました。')
    setBusy(false)
    await load()
  }

  async function deleteAward(award: Award) {
    if (
      !window.confirm(
        `「${award.name}」を削除しますか？\n受賞作品の紐付けも削除されます。`
      )
    ) {
      return
    }

    setBusy(true)
    setError('')
    setMessage('')

    const { error: rpcError } = await supabase.rpc(
      'admin_delete_award',
      {
        p_award_id: award.id,
      }
    )

    if (rpcError) {
      setError(rpcError.message)
      setBusy(false)
      return
    }

    setMessage('Awardを削除しました。')
    setBusy(false)
    await load()
  }

  async function selectWinner(postId: string) {
    if (!selectedAwardId) {
      setError('Awardを選択してください。')
      return
    }

    setBusy(true)
    setError('')
    setMessage('')

    const { error: rpcError } = await supabase.rpc(
      'admin_set_award_winner',
      {
        p_award_id: selectedAwardId,
        p_post_id: postId,
      }
    )

    if (rpcError) {
      setError(rpcError.message)
      setBusy(false)
      return
    }

    setMessage('受賞作品に追加しました。')
    setBusy(false)
    await load()
  }

  async function removeWinner(
    awardId: string,
    postId: string
  ) {
    if (!window.confirm('この投稿の受賞を取り消しますか？')) {
      return
    }

    setBusy(true)
    setError('')
    setMessage('')

    const { error: rpcError } = await supabase.rpc(
      'admin_remove_award_winner',
      {
        p_award_id: awardId,
        p_post_id: postId,
      }
    )

    if (rpcError) {
      setError(rpcError.message)
      setBusy(false)
      return
    }

    setMessage('受賞を取り消しました。')
    setBusy(false)
    await load()
  }

  const selectedAward =
    awards.find((award) => award.id === selectedAwardId) ?? null

  const selectedWinners = winners.filter(
    (winner) => winner.award_id === selectedAwardId
  )

  const winnerPostIds = new Set(
    selectedWinners.map((winner) => winner.post_id)
  )

  return (
    <main
      className="grid"
      style={{
        maxWidth: 1100,
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

        <h1>Award管理</h1>

        <p className="muted">
          Awardの作成・編集と、投稿写真から受賞作品の選定ができます。
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
        <h2>Awardを作成</h2>

        <input
          className="input"
          placeholder="例：ベストフォト賞"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <textarea
          className="input"
          rows={3}
          placeholder="説明（任意）"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <button
          className="btn primary"
          onClick={() => void createAward()}
          disabled={busy}
        >
          ＋ Awardを作成
        </button>
      </section>

      <section className="card grid">
        <h2>Award一覧</h2>

        {awards.length === 0 ? (
          <p className="muted">
            まだAwardはありません。
          </p>
        ) : (
          awards.map((award) => (
            <div
              key={award.id}
              style={{
                borderBottom: '1px solid rgba(0,0,0,0.08)',
                paddingBottom: 12,
                marginBottom: 12,
              }}
            >
              <b>{award.name}</b>

              {award.description && (
                <p className="muted">
                  {award.description}
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
                  className="btn outline"
                  onClick={() =>
                    setSelectedAwardId(award.id)
                  }
                >
                  選択
                </button>

                <button
                  className="btn outline"
                  onClick={() => void editAward(award)}
                  disabled={busy}
                >
                  編集
                </button>

                <button
                  className="btn outline"
                  style={{ color: '#d33' }}
                  onClick={() => void deleteAward(award)}
                  disabled={busy}
                >
                  削除
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="card grid">
        <h2>受賞作品</h2>

        <select
          className="input"
          value={selectedAwardId}
          onChange={(e) => setSelectedAwardId(e.target.value)}
        >
          <option value="">Awardを選択</option>

          {awards.map((award) => (
            <option key={award.id} value={award.id}>
              {award.name}
            </option>
          ))}
        </select>

        {selectedAward && (
          <p className="muted">
            {selectedAward.name}：{selectedWinners.length}作品
          </p>
        )}

        {selectedAwardId &&
          selectedWinners.length === 0 && (
            <p className="muted">
              まだ受賞作品は選ばれていません。
            </p>
          )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit,minmax(240px,1fr))',
            gap: 12,
          }}
        >
          {selectedWinners.map((winner) => {
            const post = posts.find(
              (item) => item.id === winner.post_id
            )

            if (!post) return null

            return (
              <article className="card" key={winner.post_id}>
                {signedUrls[post.image_path] && (
                  <img
                    src={signedUrls[post.image_path]}
                    alt="受賞作品"
                    style={{
                      width: '100%',
                      borderRadius: 16,
                      marginBottom: 12,
                    }}
                  />
                )}

                <b>
                  {post.participants?.name ?? '参加者'}
                </b>

                {post.comment && <p>{post.comment}</p>}

                <button
                  className="btn outline"
                  style={{
                    marginTop: 10,
                    color: '#d33',
                  }}
                  onClick={() =>
                    void removeWinner(
                      selectedAwardId,
                      post.id
                    )
                  }
                  disabled={busy}
                >
                  受賞を取り消す
                </button>
              </article>
            )
          })}
        </div>
      </section>

      <section>
        <h2>投稿写真から選ぶ</h2>
      </section>

      {loading ? (
        <section className="card">
          <b>読み込み中...</b>
        </section>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit,minmax(260px,1fr))',
            gap: 16,
          }}
        >
          {posts.map((post) => {
            const alreadyWinner =
              selectedAwardId &&
              winnerPostIds.has(post.id)

            return (
              <article className="card" key={post.id}>
                {signedUrls[post.image_path] && (
                  <img
                    src={signedUrls[post.image_path]}
                    alt="投稿写真"
                    style={{
                      width: '100%',
                      borderRadius: 16,
                      marginBottom: 12,
                    }}
                  />
                )}

                <b>
                  {post.participants?.name ?? '参加者'}
                </b>

                {post.comment && <p>{post.comment}</p>}

                <p className="muted">
                  {new Date(
                    post.created_at
                  ).toLocaleString('ja-JP')}
                </p>

                <button
                  className={
                    alreadyWinner
                      ? 'btn outline'
                      : 'btn primary'
                  }
                  onClick={() =>
                    void selectWinner(post.id)
                  }
                  disabled={
                    !selectedAwardId ||
                    busy ||
                    Boolean(alreadyWinner)
                  }
                >
                  {alreadyWinner
                    ? '✓ 受賞作品'
                    : '🏆 この投稿を受賞作品にする'}
                </button>
              </article>
            )
          })}
        </div>
      )}
    </main>
  )
}
