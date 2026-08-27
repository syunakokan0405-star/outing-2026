import ParticipantJoin from '@/components/auth/ParticipantJoin'
import { getEventId } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default function JoinPage() {
  return <main className="shell"><ParticipantJoin eventId={getEventId()} /></main>
}
