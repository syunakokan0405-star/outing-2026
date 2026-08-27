-- OUTING 2026 setup verification. Read-only.
WITH event_row AS (
  SELECT id, name, status
  FROM public.events
  WHERE name = 'Outing 2026'
  ORDER BY created_at
  LIMIT 1
)
SELECT
  e.id AS event_id,
  e.name,
  e.status,
  (SELECT count(*) FROM public.participants p WHERE p.event_id = e.id) AS participant_count,
  (SELECT count(*) FROM public.admin_users a WHERE a.event_id = e.id) AS admin_count,
  (SELECT count(*) FROM public.schedule_items s WHERE s.event_id = e.id) AS schedule_count,
  (SELECT count(*) FROM public.guide_sections g WHERE g.event_id = e.id) AS guide_section_count,
  EXISTS (SELECT 1 FROM storage.buckets b WHERE b.id = 'outing-photos' AND b.public = false) AS private_photo_bucket_exists,
  to_regprocedure('public.claim_participant(uuid,uuid)') IS NOT NULL AS claim_rpc_exists,
  to_regprocedure('public.submit_mission_post(uuid,uuid,text,text,text,uuid[])') IS NOT NULL AS submit_rpc_exists,
  to_regprocedure('public.create_mission_drop(uuid,jsonb)') IS NOT NULL AS drop_rpc_exists
FROM event_row e;

-- Useful secondary checks
SELECT id, name, auth_user_id IS NOT NULL AS claimed, is_active
FROM public.participants
WHERE event_id = (SELECT id FROM public.events WHERE name='Outing 2026' ORDER BY created_at LIMIT 1)
ORDER BY name;
