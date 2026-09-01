'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
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
  const [notifications, setNotifications] = useState<NotificationRow[]>([])

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
      .order('created_at', { ascending: false })
      .limit(50)

    if (!error) {
      setNotifications((data ?? []) as NotificationRow[])
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

  async function markRead(notificationId: string) {
    await supabase.rpc('mark_notification_read', {
      p_notification_id: notificationId,
    })

    setNotifications((current) =>
      current.map((notification) =>
        notification.id === notificationId
          ? { ...notification, is_read: true }
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

    await supabase.rpc('mark_all_notifications_read', {
      p_event_id: participant.event_id,
    })

    setNotifications((current) =>
      current.map((notification) => ({
        ...notification,
        is_read: true,
      })),
    )
  }

  return (
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
        onClick={() => setOpen((value) => !value)}
        aria-label="通知"
        style={{
          position: 'relative',
          width: 48,
          height: 48,
          borderRadius: 999,
          border: '1px solid rgba(255,255,255,0.20)',
          background: 'rgba(20,20,24,0.94)',
          color: '#fff',
          fontSize: 22,
          cursor: 'pointer',
          boxShadow: '0 8px 24px rgba(0,0,0,0.20)',
        }}
      >
        🔔

        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -3,
              right: -3,
              minWidth: 20,
              height: 20,
              padding: '0 5px',
              borderRadius: 999,
              background: '#ef4444',
              color: '#fff',
              fontSize: 11,
              fontWeight: 800,
              display: 'grid',
              placeItems: 'center',
              border: '2px solid #16161b',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 58,
            right: 0,
            width: 'min(360px, calc(100vw - 32px))',
            maxHeight: '70vh',
            overflowY: 'auto',
            borderRadius: 18,
            background: '#16161b',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 18px 50px rgba(0,0,0,0.35)',
            padding: 14,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <strong
              style={{
                color: '#fff',
                fontSize: 18,
              }}
            >
              通知
            </strong>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                style={{
                  border: '1px solid rgba(255,255,255,0.18)',
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.06)',
                  color: '#fff',
                  padding: '6px 10px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                すべて既読
              </button>
            )}
          </div>

          {loading ? (
            <p
              style={{
                color: 'rgba(255,255,255,0.65)',
              }}
            >
              読み込み中...
            </p>
          ) : notifications.length === 0 ? (
            <p
              style={{
                color: 'rgba(255,255,255,0.65)',
              }}
            >
              まだ通知はありません。
            </p>
          ) : (
            <div
              style={{
                display: 'grid',
                gap: 8,
              }}
            >
              {notifications.map((notification) => {
                const content = (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 14,
                      background: notification.is_read
                        ? 'rgba(255,255,255,0.06)'
                        : 'rgba(139,92,246,0.22)',
                      border: notification.is_read
                        ? '1px solid rgba(255,255,255,0.06)'
                        : '1px solid rgba(167,139,250,0.30)',
                      transition: '0.2s ease',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 10,
                      }}
                    >
                      <b
                        style={{
                          color: '#fff',
                        }}
                      >
                        {notification.title}
                      </b>

                      {!notification.is_read && (
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            flex: '0 0 8px',
                            borderRadius: 999,
                            background: '#a78bfa',
                            marginTop: 6,
                          }}
                        />
                      )}
                    </div>

                    {notification.body && (
                      <p
                        style={{
                          marginBottom: 6,
                          color: 'rgba(255,255,255,0.72)',
                          lineHeight: 1.6,
                        }}
                      >
                        {notification.body}
                      </p>
                    )}

                    <small
                      style={{
                        color: 'rgba(255,255,255,0.48)',
                      }}
                    >
                      {new Date(
                        notification.created_at,
                      ).toLocaleString('ja-JP', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </small>
                  </div>
                )

                if (notification.href) {
                  return (
                    <Link
                      key={notification.id}
                      href={notification.href}
                      style={{
                        textDecoration: 'none',
                        color: 'inherit',
                      }}
                      onClick={() => {
                        void markRead(notification.id)
                        setOpen(false)
                      }}
                    >
                      {content}
                    </Link>
                  )
                }

                return (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() =>
                      void markRead(notification.id)
                    }
                    style={{
                      border: 0,
                      padding: 0,
                      textAlign: 'left',
                      color: 'inherit',
                      background: 'transparent',
                      cursor: 'pointer',
                      width: '100%',
                    }}
                  >
                    {content}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}