import { requireParticipant } from '@/lib/auth'
import PendingPostSync from '@/components/PendingPostSync'
import NotificationBell from '@/components/NotificationBell'

export default async function ParticipantLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireParticipant()

  return (
    <>
      <PendingPostSync />
      <NotificationBell />
      {children}
    </>
  )
}