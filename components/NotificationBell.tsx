'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import Link from 'next/link'
import {
  Bell,
  CheckCheck,
  ChevronRight,
  X,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type NotificationRow = {
  id: string
  title: string
  body: string | null
  href: string | null
  type: string
  is_read: boolean
  created_at: string
}

export default function NotificationBell() {
  const supabase = useMemo(() => createClient(), [])

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [notifications, setNotifications] =
    useState<NotificationRow[]>([])

  const unreadCount = notifications.filter(
    (notification) => !notification.is_read,
  ).length

  const loadNotifications = useCallback(async () => {
    setLoading(true)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setNotifications([])
      setLoading(false)
      return
    }

    const { data: participant } = await supabase
      .from('participants')
      .select('id,event_id')
      .eq('auth_user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()

    if (!participant) {
      setNotifications([])
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('notifications')
      .select(`
        id,
        title,
        body,
        href,
        type,
        is_read,
        created_at
      `)
      .eq('event_id', participant.event_id)
      .eq('participant_id', participant.id)
      .order('created_at', {
        ascending: false,
      })
      .limit(50)

    if (!error) {
      setNotifications(
        (data ?? []) as NotificationRow[],
      )
    }

    setLoading(false)
  }, [supabase])

  useEffect(() => {
    void loadNotifications()

    const channel = supabase
      .channel('participant-notifications')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
        },
        () => void loadNotifications(),
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loadNotifications, supabase])

  async function markRead(
    notificationId: string,
  ) {
    await supabase.rpc(
      'mark_notification_read',
      {
        p_notification_id: notificationId,
      },
    )

    setNotifications((current) =>
      current.map((notification) =>
        notification.id === notificationId
          ? {
              ...notification,
              is_read: true,
            }
          : notification,
      ),
    )
  }

  async function markAllRead() {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return

    const { data: participant } = await supabase
      .from('participants')
      .select('event_id')
      .eq('auth_user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()

    if (!participant) return

    await supabase.rpc(
      'mark_all_notifications_read',
      {
        p_event_id: participant.event_id,
      },
    )

    setNotifications((current) =>
      current.map((notification) => ({
        ...notification,
        is_read: true,
      })),
    )
  }

  function formatDate(date: string) {
    return new Date(date).toLocaleString(
      'ja-JP',
      {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      },
    )
  }

  return (
    <>
      <div
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          zIndex: 1000,
        }}
      >
        <button
          type="button"
          onClick={() =>
            setOpen((value) => !value)
          }
          aria-label="通知"
          style={{
            position: 'relative',
            width: 46,
            height: 46,
            padding: 0,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 999,
            border:
              '1px solid rgba(255,255,255,.13)',
            background:
              'rgba(14,16,22,.72)',
            color: '#fff',
            cursor: 'pointer',
            backdropFilter: 'blur(18px)',
            WebkitBackdropFilter:
              'blur(18px)',
            boxShadow:
              '0 12px 34px rgba(0,0,0,.24)',
          }}
        >
          <Bell
            size={20}
            strokeWidth={1.8}
          />

          {unreadCount > 0 && (
            <span
              style={{
                position: 'absolute',
                top: -3,
                right: -3,
                minWidth: 19,
                height: 19,
                padding: '0 5px',
                display: 'grid',
                placeItems: 'center',
                borderRadius: 999,
                background: '#8b5cf6',
                color: '#fff',
                fontSize: 10,
                fontWeight: 800,
                border:
                  '2px solid rgba(15,17,24,.95)',
              }}
            >
              {unreadCount > 99
                ? '99+'
                : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <section
            style={{
              position: 'absolute',
              top: 58,
              right: 0,
              width:
                'min(380px, calc(100vw - 32px))',
              maxHeight: '72vh',
              overflowY: 'auto',
              borderRadius: 22,
              border:
                '1px solid rgba(255,255,255,.10)',
              background:
                'rgba(14,16,22,.92)',
              color: '#fff',
              boxShadow:
                '0 24px 70px rgba(0,0,0,.42)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter:
                'blur(24px)',
            }}
          >
            <header
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 2,
                padding: '16px 16px 13px',
                display: 'flex',
                alignItems: 'center',
                justifyContent:
                  'space-between',
                gap: 12,
                background:
                  'rgba(14,16,22,.90)',
                backdropFilter: 'blur(20px)',
                borderBottom:
                  '1px solid rgba(255,255,255,.07)',
              }}
            >
              <div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 10,
                    letterSpacing: '.13em',
                    fontWeight: 700,
                    color:
                      'rgba(255,255,255,.44)',
                  }}
                >
                  NOTIFICATIONS
                </p>

                <h2
                  style={{
                    margin: '4px 0 0',
                    fontSize: 20,
                    letterSpacing: '-.02em',
                  }}
                >
                  通知
                </h2>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      void markAllRead()
                    }
                    aria-label="すべて既読"
                    style={{
                      width: 38,
                      height: 38,
                      padding: 0,
                      display: 'grid',
                      placeItems: 'center',
                      borderRadius: 999,
                      border:
                        '1px solid rgba(255,255,255,.10)',
                      background:
                        'rgba(255,255,255,.05)',
                      color:
                        'rgba(255,255,255,.76)',
                      cursor: 'pointer',
                    }}
                  >
                    <CheckCheck
                      size={18}
                      strokeWidth={1.8}
                    />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    setOpen(false)
                  }
                  aria-label="閉じる"
                  style={{
                    width: 38,
                    height: 38,
                    padding: 0,
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: 999,
                    border:
                      '1px solid rgba(255,255,255,.10)',
                    background:
                      'rgba(255,255,255,.05)',
                    color:
                      'rgba(255,255,255,.76)',
                    cursor: 'pointer',
                  }}
                >
                  <X
                    size={18}
                    strokeWidth={1.8}
                  />
                </button>
              </div>
            </header>

            <div
              style={{
                padding: 10,
              }}
            >
              {loading ? (
                <p
                  style={{
                    margin: 0,
                    padding: 18,
                    color:
                      'rgba(255,255,255,.50)',
                    fontSize: 13,
                  }}
                >
                  読み込み中...
                </p>
              ) : notifications.length ===
                0 ? (
                <div
                  style={{
                    padding: '34px 18px',
                    textAlign: 'center',
                  }}
                >
                  <Bell
                    size={24}
                    strokeWidth={1.5}
                    style={{
                      opacity: 0.45,
                    }}
                  />

                  <p
                    style={{
                      margin: '12px 0 0',
                      color:
                        'rgba(255,255,255,.52)',
                      fontSize: 13,
                    }}
                  >
                    まだ通知はありません。
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gap: 6,
                  }}
                >
                  {notifications.map(
                    (notification) => {
                      const content = (
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns:
                              '1fr auto',
                            alignItems:
                              'center',
                            gap: 12,
                            padding:
                              '13px 12px',
                            borderRadius: 16,
                            background:
                              notification.is_read
                                ? 'rgba(255,255,255,.035)'
                                : 'rgba(139,92,246,.12)',
                            border:
                              notification.is_read
                                ? '1px solid rgba(255,255,255,.04)'
                                : '1px solid rgba(167,139,250,.16)',
                          }}
                        >
                          <div
                            style={{
                              minWidth: 0,
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems:
                                  'center',
                                gap: 7,
                              }}
                            >
                              {!notification.is_read && (
                                <span
                                  style={{
                                    width: 6,
                                    height: 6,
                                    flex:
                                      '0 0 6px',
                                    borderRadius:
                                      999,
                                    background:
                                      '#a78bfa',
                                  }}
                                />
                              )}

                              <strong
                                style={{
                                  fontSize: 14,
                                  lineHeight: 1.45,
                                }}
                              >
                                {
                                  notification.title
                                }
                              </strong>
                            </div>

                            {notification.body && (
                              <p
                                style={{
                                  margin:
                                    '6px 0 0',
                                  color:
                                    'rgba(255,255,255,.61)',
                                  fontSize: 12,
                                  lineHeight: 1.55,
                                }}
                              >
                                {
                                  notification.body
                                }
                              </p>
                            )}

                            <small
                              style={{
                                display: 'block',
                                marginTop: 7,
                                color:
                                  'rgba(255,255,255,.34)',
                                fontSize: 10,
                              }}
                            >
                              {formatDate(
                                notification.created_at,
                              )}
                            </small>
                          </div>

                          {notification.href && (
                            <ChevronRight
                              size={16}
                              strokeWidth={1.7}
                              style={{
                                opacity: 0.4,
                              }}
                            />
                          )}
                        </div>
                      )

                      if (
                        notification.href
                      ) {
                        return (
                          <Link
                            key={
                              notification.id
                            }
                            href={
                              notification.href
                            }
                            style={{
                              textDecoration:
                                'none',
                              color: 'inherit',
                            }}
                            onClick={() => {
                              void markRead(
                                notification.id,
                              )
                              setOpen(false)
                            }}
                          >
                            {content}
                          </Link>
                        )
                      }

                      return (
                        <button
                          key={
                            notification.id
                          }
                          type="button"
                          onClick={() =>
                            void markRead(
                              notification.id,
                            )
                          }
                          style={{
                            border: 0,
                            padding: 0,
                            textAlign: 'left',
                            color: 'inherit',
                            background:
                              'transparent',
                            cursor: 'pointer',
                            width: '100%',
                          }}
                        >
                          {content}
                        </button>
                      )
                    },
                  )}
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </>
  )
}