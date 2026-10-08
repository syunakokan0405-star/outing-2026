/** Shared participant heading, matching the Guide page. */
export default function ParticipantHeader({ title }: { title?: string }) {
  return (
    <header className="participantHeader">
      {title ? (
        <p className="outingSerifEn participantBrand">OUTING 2026</p>
      ) : (
        <h1 className="outingSerifEn participantBrand">OUTING 2026</h1>
      )}
      {title && <h1 className="outingSerifEn participantTitle">{title}</h1>}
    </header>
  )
}
