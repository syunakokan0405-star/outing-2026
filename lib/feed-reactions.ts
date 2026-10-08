export function applyReactionChange(
  reactions: { participant_id: string }[],
  participantId: string,
  event: string,
): { participant_id: string }[] | undefined {
  if (event === 'DELETE') return reactions.filter(row => row.participant_id !== participantId)
  if (event === 'INSERT') {
    return reactions.some(row => row.participant_id === participantId)
      ? reactions : [...reactions, { participant_id: participantId }]
  }
}
