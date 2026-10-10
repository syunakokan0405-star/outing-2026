import ParticipantJoin from '@/components/auth/ParticipantJoin'
import { redirect } from 'next/navigation'
import { getCurrentParticipant, getEventId } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function JoinPage() {
  // Use the same verified session and active-participant lookup as the Home
  // guard, so a browser-only session cannot bounce Home back to Join forever.
  if (await getCurrentParticipant()) redirect('/')
  return <ParticipantJoin eventId={getEventId()} />
}
