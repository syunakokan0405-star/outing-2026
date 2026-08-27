import { requireParticipant } from '@/lib/auth'
import PendingPostSync from '@/components/PendingPostSync'

export default async function ParticipantLayout({ children }: { children: React.ReactNode }) {
  await requireParticipant()
  return <>
    <PendingPostSync />
    {children}
  </>
}
