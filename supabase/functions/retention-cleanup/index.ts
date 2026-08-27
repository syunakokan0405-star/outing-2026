// Scheduled Supabase Edge Function for 90-day photo cleanup.
// Deploy with a server-side service-role secret. Never expose that secret to the browser.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async () => {
  const url = Deno.env.get('SUPABASE_URL')!
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(url, serviceRole)

  const { data: candidates, error: candidateError } = await supabase
    .rpc('retention_cleanup_candidates', { p_limit: 500 })

  if (candidateError) {
    return new Response(JSON.stringify({ error: candidateError.message }), { status: 500 })
  }

  let removed = 0
  for (const item of candidates ?? []) {
    const { error: storageError } = await supabase.storage
      .from('outing-photos')
      .remove([item.image_path])

    if (storageError) continue

    const { error: markError } = await supabase
      .rpc('mark_retention_cleanup_done', { p_post_id: item.post_id })

    if (!markError) removed += 1
  }

  return Response.json({ checked: candidates?.length ?? 0, removed })
})
