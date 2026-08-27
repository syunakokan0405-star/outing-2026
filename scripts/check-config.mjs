const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_EVENT_ID',
]

const missing = required.filter((name) => !process.env[name]?.trim())
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}`)
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
if (!/^https:\/\/.+\.supabase\.co\/?$/.test(url)) {
  console.error('NEXT_PUBLIC_SUPABASE_URL does not look like a Supabase project URL')
  process.exit(1)
}

const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
if (!key.startsWith('sb_publishable_') && key.split('.').length !== 3) {
  console.error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY does not look like a publishable/legacy anon key')
  process.exit(1)
}

const eventId = process.env.NEXT_PUBLIC_EVENT_ID
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) {
  console.error('NEXT_PUBLIC_EVENT_ID is not a valid UUID')
  process.exit(1)
}

console.log('Outing environment configuration looks valid.')
