export const LIKED_STREAM_TTL = 60_000

export function canReuseLikedStream(
  cached: { savedAt: number; currentParticipantId: string | null; currentEventId: string | null } | undefined,
  participant: { id: string; event_id: string },
  now = Date.now(),
) {
  return !!cached && cached.currentParticipantId === participant.id
    && cached.currentEventId === participant.event_id
    && now >= cached.savedAt && now - cached.savedAt < LIKED_STREAM_TTL
}
