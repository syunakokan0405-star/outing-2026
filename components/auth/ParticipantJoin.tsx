
'use client'

import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useRouter } from 'next/navigation'
import {
  Check,
  Search,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type ParticipantChoice = {
  participant_id: string
  participant_name: string
  is_claimed: boolean
}

const CONSENT_VERSION = '2026-08-v1'

export default function ParticipantJoin({
  eventId,
}: {
  eventId: string
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [choices, setChoices] = useState<ParticipantChoice[]>([])
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [consent, setConsent] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function boot() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        let authUser = user

        if (!authUser) {
          const {
            data,
            error: signInError,
          } = await supabase.auth.signInAnonymously()

          if (signInError) {
            throw signInError
          }

          authUser = data.user
        }

        if (!authUser) {
          throw new Error('匿名ログインを開始できませんでした')
        }

        const { data: mine } = await supabase
          .from('participants')
          .select('id')
          .eq('event_id', eventId)
          .eq('auth_user_id', authUser.id)
          .maybeSingle()

        if (mine?.id) {
          router.replace('/')
          router.refresh()
          return
        }

        const {
          data,
          error: listError,
        } = await supabase.rpc(
          'list_available_participants',
          {
            p_event_id: eventId,
          },
        )

        if (listError) {
          throw listError
        }

        if (!cancelled) {
          setChoices(
            (data ?? []) as ParticipantChoice[],
          )
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? e.message
              : '名簿を読み込めませんでした',
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void boot()

    return () => {
      cancelled = true
    }
  }, [eventId, router, supabase])

  const filtered = choices.filter((participant) =>
    participant.participant_name
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  )

  async function submit(event: FormEvent) {
    event.preventDefault()

    if (!selected || !consent || submitting) {
      return
    }

    setSubmitting(true)
    setError('')

    const { error: claimError } = await supabase.rpc(
      'claim_participant',
      {
        p_event_id: eventId,
        p_participant_id: selected,
      },
    )

    if (claimError) {
      setError(
        claimError.message.includes('already claimed')
          ? 'この名前はすでに別の端末で使用されています。運営に確認してください。'
          : claimError.message,
      )

      setSubmitting(false)
      return
    }

    const { error: consentError } =
      await supabase.rpc(
        'record_participant_consent',
        {
          p_event_id: eventId,
          p_consent_version: CONSENT_VERSION,
        },
      )

    if (consentError) {
      setError(
        '参加登録は完了しましたが、同意記録の保存に失敗しました。運営に確認してください。',
      )

      setSubmitting(false)
      return
    }

    router.replace('/')
    router.refresh()
  }

  const selectedParticipant =
    choices.find(
      (participant) =>
        participant.participant_id === selected,
    ) ?? null

  return (
    <main
      className="participantUi outingSans"
      style={{
        position: 'fixed',
        inset: 0,
        minHeight: '100svh',
        overflowY: 'auto',
        background: '#0a0b10',
        color: '#fff',
      }}
    >
      <img
        src="/outing-bg.jpg"
        alt=""
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: 0.38,
        }}
      />

      <div
        style={{
          position: 'fixed',
          inset: 0,
          background:
            'linear-gradient(180deg, rgba(8,9,14,.32) 0%, rgba(8,9,14,.70) 42%, rgba(8,9,14,.97) 100%)',
        }}
      />

      <form
        onSubmit={submit}
        style={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          maxWidth: 520,
          margin: '0 auto',
          padding: '52px 20px 42px',
          boxSizing: 'border-box',
        }}
      >
        <header style={{ marginBottom: 36, textAlign: 'center' }}>
          <p
            className="outingSerifEn"
            style={{
              margin: 0,
              fontSize: 10,
              letterSpacing: '.26em',
              color: 'rgba(255,255,255,.52)',
            }}
          >
            WELCOME TO
          </p>

          <h1
            className="outingSerifEn"
            style={{
              margin: '8px 0 0',
              fontSize: 42,
              lineHeight: 1,
              fontWeight: 500,
              letterSpacing: '.10em',
            }}
          >
            OUTING 2026
          </h1>

          <div
            style={{
              width: 42,
              height: 1,
              margin: '20px auto 0',
              background: 'rgba(255,255,255,.32)',
            }}
          />

          <p
            className="outingSerifJa"
            style={{
              margin: '18px auto 0',
              maxWidth: 330,
              fontSize: 14,
              color: 'rgba(255,255,255,.66)',
            }}
          >
            あなたの名前を選んで、
            <br />
            Outing 2026へ参加してください。
          </p>
        </header>

        <section
          style={{
            padding: 18,
            border: '1px solid rgba(255,255,255,.10)',
            borderRadius: 20,
            background: 'rgba(14,15,22,.66)',
            backdropFilter: 'blur(18px)',
            boxShadow: '0 20px 60px rgba(0,0,0,.28)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 14,
            }}
          >
            <UserRound size={17} strokeWidth={1.8} color="#b9a4ff" />

            <div>
              <p
                className="outingSerifEn"
                style={{
                  margin: 0,
                  fontSize: 9,
                  letterSpacing: '.16em',
                  color: 'rgba(255,255,255,.38)',
                }}
              >
                PARTICIPANT
              </p>

              <h2
                style={{
                  margin: '2px 0 0',
                  fontSize: 15,
                  fontWeight: 600,
                }}
              >
                名前を選択
              </h2>
            </div>
          </div>

          <div style={{ position: 'relative', marginBottom: 12 }}>
            <Search
              size={16}
              strokeWidth={1.8}
              style={{
                position: 'absolute',
                top: '50%',
                left: 13,
                transform: 'translateY(-50%)',
                color: 'rgba(255,255,255,.36)',
              }}
            />

            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="名前で検索"
              aria-label="名前で検索"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '13px 14px 13px 40px',
                borderRadius: 13,
                border: '1px solid rgba(255,255,255,.09)',
                background: 'rgba(255,255,255,.05)',
                color: '#fff',
                font: 'inherit',
                fontSize: 13,
                outline: 'none',
              }}
            />
          </div>

          {loading ? (
            <div
              style={{
                padding: '28px 8px',
                textAlign: 'center',
                fontSize: 12,
                color: 'rgba(255,255,255,.40)',
              }}
            >
              名簿を読み込み中…
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gap: 7,
                maxHeight: 280,
                overflowY: 'auto',
                paddingRight: 2,
              }}
            >
              {filtered.map((participant) => {
                const active =
                  selected === participant.participant_id

                return (
                  <button
                    type="button"
                    key={participant.participant_id}
                    disabled={participant.is_claimed}
                    onClick={() =>
                      setSelected(participant.participant_id)
                    }
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 11,
                      padding: '12px 13px',
                      borderRadius: 13,
                      border: active
                        ? '1px solid rgba(167,139,250,.52)'
                        : '1px solid rgba(255,255,255,.07)',
                      background: active
                        ? 'rgba(124,58,237,.16)'
                        : 'rgba(255,255,255,.025)',
                      color: participant.is_claimed
                        ? 'rgba(255,255,255,.28)'
                        : '#fff',
                      textAlign: 'left',
                      cursor: participant.is_claimed
                        ? 'default'
                        : 'pointer',
                      opacity: participant.is_claimed ? 0.58 : 1,
                    }}
                  >
                    <span
                      style={{
                        width: 30,
                        height: 30,
                        flexShrink: 0,
                        display: 'grid',
                        placeItems: 'center',
                        borderRadius: '50%',
                        background: active
                          ? '#7c3aed'
                          : 'rgba(255,255,255,.06)',
                        border: '1px solid rgba(255,255,255,.08)',
                      }}
                    >
                      {active ? (
                        <Check size={15} strokeWidth={2.2} />
                      ) : (
                        <UserRound size={14} strokeWidth={1.8} />
                      )}
                    </span>

                    <span
                      className="outingSerifJa"
                      style={{
                        fontSize: 14,
                        fontWeight: 400,
                      }}
                    >
                      {participant.participant_name}
                    </span>

                    {participant.is_claimed && (
                      <span
                        style={{
                          marginLeft: 'auto',
                          fontSize: 9,
                          letterSpacing: '.08em',
                          color: 'rgba(255,255,255,.34)',
                        }}
                      >
                        使用中
                      </span>
                    )}
                  </button>
                )
              })}

              {!filtered.length && (
                <div
                  style={{
                    padding: '26px 8px',
                    textAlign: 'center',
                    fontSize: 12,
                    color: 'rgba(255,255,255,.38)',
                  }}
                >
                  該当する名前がありません。
                </div>
              )}
            </div>
          )}
        </section>

        {selectedParticipant && (
          <div
            style={{
              marginTop: 12,
              padding: '12px 15px',
              borderRadius: 14,
              border: '1px solid rgba(167,139,250,.16)',
              background: 'rgba(124,58,237,.09)',
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 10,
                color: '#b9a4ff',
                letterSpacing: '.10em',
              }}
            >
              SELECTED
            </p>

            <p
              className="outingSerifJa"
              style={{
                margin: '4px 0 0',
                fontSize: 16,
              }}
            >
              {selectedParticipant.participant_name}
            </p>
          </div>
        )}

        <section
          aria-labelledby="consent-title"
          style={{
            marginTop: 14,
            padding: 18,
            borderRadius: 20,
            border: '1px solid rgba(255,255,255,.08)',
            background: 'rgba(12,13,19,.72)',
            backdropFilter: 'blur(16px)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
            }}
          >
            <ShieldCheck size={17} strokeWidth={1.8} color="#b9a4ff" />

            <strong id="consent-title" style={{ fontSize: 13 }}>
              写真・プライバシーについて
            </strong>
          </div>

          <ul
            style={{
              margin: '13px 0 16px',
              paddingLeft: 19,
              fontSize: 11,
              lineHeight: 1.8,
              color: 'rgba(255,255,255,.52)',
            }}
          >
            <li>
              投稿写真はOuting 2026参加者のGalleryから閲覧できます。
            </li>
            <li>
              「Stream」を選んだ写真は全体Streamにも即時表示されます。
            </li>
            <li>
              参加者は表示されている写真をダウンロードできます。
            </li>
            <li>
              写真は原則90日保存し、その後自動削除します。
            </li>
            <li>
              本人または運営は必要に応じて投稿を削除できます。
            </li>
          </ul>

          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 11,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              style={{
                width: 17,
                height: 17,
                marginTop: 2,
                accentColor: '#7c3aed',
              }}
            />

            <span
              style={{
                fontSize: 12,
                lineHeight: 1.65,
                color: consent
                  ? '#fff'
                  : 'rgba(255,255,255,.68)',
              }}
            >
              内容を確認し、Outing 2026での写真利用に同意します。
            </span>
          </label>
        </section>

        {error && (
          <div
            style={{
              marginTop: 13,
              padding: '12px 14px',
              borderRadius: 13,
              border: '1px solid rgba(248,113,113,.20)',
              background: 'rgba(248,113,113,.07)',
              color: '#fca5a5',
              fontSize: 11,
              lineHeight: 1.6,
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!selected || !consent || loading || submitting}
          style={{
            width: '100%',
            marginTop: 16,
            padding: '15px 18px',
            border: 0,
            borderRadius: 15,
            background:
              !selected || !consent || loading || submitting
                ? 'rgba(124,58,237,.30)'
                : 'linear-gradient(135deg,#7c3aed,#6d28d9)',
            color: '#fff',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '.10em',
            cursor:
              !selected || !consent || loading || submitting
                ? 'default'
                : 'pointer',
            boxShadow:
              selected && consent
                ? '0 12px 32px rgba(124,58,237,.24)'
                : 'none',
          }}
        >
          {submitting ? 'JOINING...' : 'JOIN OUTING'}
        </button>

        <p
          style={{
            margin: '15px 0 0',
            textAlign: 'center',
            fontSize: 9,
            lineHeight: 1.7,
            letterSpacing: '.04em',
            color: 'rgba(255,255,255,.28)',
          }}
        >
          登録後、この端末があなたの参加者アカウントとして使用されます。
        </p>
      </form>
    </main>
  )
}
