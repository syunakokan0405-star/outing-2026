/** Shared participant heading, matching the Guide page. */
export default function ParticipantHeader({
  title,
  showLogo = true,
}: {
  title?: string
  showLogo?: boolean
}) {
  return (
    <header className={`participantHeader${showLogo ? ' participantHeaderWithLogo' : ''}`}>
      {showLogo && <span className="participantHeaderLogo" aria-hidden="true" />}
      <div>
        {title ? (
          <p className="outingSerifEn participantBrand">OUTING 2026</p>
        ) : (
          <h1 className="outingSerifEn participantBrand">OUTING 2026</h1>
        )}
        {title && <h1 className="outingSerifEn participantTitle">{title}</h1>}
      </div>
    </header>
  )
}
