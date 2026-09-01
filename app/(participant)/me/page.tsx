'use client'

import { useEffect, useMemo, useState } from 'react'
import LivePosts from '@/components/LivePosts'
import { createClient } from '@/lib/supabase/client'

export default function Me() {
  const supabase = useMemo(() => createClient(), [])

  const [showRank, setShowRank] = useState(false)
  const [name, setName] = useState('My Page')
  const [score, setScore] = useState(0)
  const [connections, setConnections] = useState(0)
  const [rank, setRank] = useState<number | null>(null)

  useEffect(() => {
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      const { data: participant } = await supabase
        .from('participants')
        .select('id,event_id,name')
        .eq('auth_user_id', user.id)
        .maybeSingle()

      if (!participant) return

      setName(participant.name)

      const { data: points } = await supabase
        .from('point_transactions')
        .select('points')
        .eq('participant_id', participant.id)
        .eq('is_active', true)

      setScore(
        (points ?? []).reduce(
          (sum, item) => sum + (item.points ?? 0),
          0,
        ),
      )

      const { count: a } = await supabase
        .from('connections')
        .select('*', {
          count: 'exact',
          head: true,
        })
        .eq('participant_a_id', participant.id)

      const { count: b } = await supabase
        .from('connections')
        .select('*', {
          count: 'exact',
          head: true,
        })
        .eq('participant_b_id', participant.id)

      setConnections((a ?? 0) + (b ?? 0))

      const { data: rankData } = await supabase.rpc(
        'get_my_rank',
        {
          p_event_id: participant.event_id,
        },
      )

      if (
        Array.isArray(rankData) &&
        rankData[0]?.rank
      ) {
        setRank(Number(rankData[0].rank))
      }
    })()
  }, [supabase])

  return (
    <main className="shell grid">
      <div>
        <div className="brand">OUTING 2026</div>
        <h1>My Page</h1>
      </div>

      <section className="card">
        <h2>{name}</h2>

        <div className="row">
          <div>
            <div className="stat">{score}</div>
            <span className="muted">SCORE</span>
          </div>

          <div>
            <div className="stat">
              {connections}
            </div>
            <span className="muted">
              CONNECTIONS
            </span>
          </div>
        </div>

        <button
          className="btn outline"
          onClick={() =>
            setShowRank((value) => !value)
          }
        >
          {showRank
            ? 'ランキングを隠す'
            : '自分のランキングを確認'}
        </button>

        {showRank && (
          <p>
            <b>
              {rank
                ? `現在 ${rank}位 / ${score}pt`
                : `${score}pt`}
            </b>
          </p>
        )}
      </section>

      <section>
        <h2>My Gallery</h2>

        <p className="muted">
          自分が投稿した写真をまとめて確認できます。
        </p>
      </section>

      <LivePosts mode="gallery" />
    </main>
  )
}