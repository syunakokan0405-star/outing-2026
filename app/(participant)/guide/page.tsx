import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const categories = [
  { type: 'schedule', label: '📅 Schedule' },
  { type: 'packing', label: '🎒 持ち物' },
  { type: 'rules', label: '⚠️ 注意事項' },
  { type: 'place', label: '📍 施設・集合場所' },
  { type: 'groups', label: '👥 班分け' },
  { type: 'other', label: '📖 しおり全文・その他' },
]

export default async function Guide() {
  const supabase = await createClient()
  const eventId = process.env.NEXT_PUBLIC_EVENT_ID

  if (!eventId) {
    return (
      <main className="shell grid">
        <section className="card">
          <h2>設定エラー</h2>
          <p>EVENT ID が設定されていません。</p>
        </section>
      </main>
    )
  }

  const { data: sections, error } = await supabase
    .from('guide_sections')
    .select('id,section_type,title,body,sort_order')
    .eq('event_id', eventId)
    .order('sort_order', { ascending: true })

  return (
    <main className="shell grid">
      <div>
        <div className="brand">OUTING 2026</div>
        <h1>Guide</h1>
      </div>

      {error && (
        <section className="card">
          <h2>Guideを読み込めませんでした</h2>
          <p>{error.message}</p>
        </section>
      )}

      {!error &&
        categories.map((category) => {
          const categorySections =
            sections?.filter(
              (section) =>
                section.section_type === category.type
            ) ?? []

          return (
            <details className="card" key={category.type}>
              <summary
                style={{
                  cursor: 'pointer',
                  fontSize: '1.25rem',
                  fontWeight: 800,
                }}
              >
                {category.label}
              </summary>

              <div style={{ marginTop: 16 }}>
                {categorySections.length === 0 ? (
                  <p className="muted">
                    現在情報はありません。
                  </p>
                ) : (
                  categorySections.map((section) => (
                    <div
                      key={section.id}
                      style={{ marginBottom: 20 }}
                    >
                      <h2>{section.title}</h2>

                      <p
                        style={{
                          whiteSpace: 'pre-wrap',
                          lineHeight: 1.8,
                        }}
                      >
                        {section.body}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </details>
          )
        })}
    </main>
  )
}