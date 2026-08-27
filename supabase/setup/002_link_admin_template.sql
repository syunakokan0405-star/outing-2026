-- Link an EXISTING Supabase Auth email/password user to Outing admin permissions.
-- 1) Create the user in Supabase Dashboard > Authentication > Users.
-- 2) Replace the email below.
-- 3) Run this script in SQL Editor.

DO $$
DECLARE
  v_event_id uuid;
  v_auth_user_id uuid;
  v_email text := 'CHANGE_ME@example.com';
  v_display_name text := 'Test Admin';
BEGIN
  IF v_email = 'CHANGE_ME@example.com' THEN
    RAISE EXCEPTION 'Edit v_email before running this script';
  END IF;

  SELECT id INTO v_event_id
  FROM public.events
  WHERE name = 'Outing 2026'
  ORDER BY created_at
  LIMIT 1;

  SELECT id INTO v_auth_user_id
  FROM auth.users
  WHERE lower(email) = lower(v_email)
  ORDER BY created_at
  LIMIT 1;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Outing 2026 event not found';
  END IF;

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Auth user with email % not found', v_email;
  END IF;

  INSERT INTO public.admin_users (
    event_id,
    auth_user_id,
    display_name,
    role,
    can_manage_missions,
    can_manage_stream,
    can_manage_photos,
    can_manage_awards,
    can_manage_guide,
    can_manage_participants
  ) VALUES (
    v_event_id,
    v_auth_user_id,
    v_display_name,
    'admin',
    true, true, true, true, true, true
  )
  ON CONFLICT (event_id, auth_user_id)
  DO UPDATE SET
    display_name = EXCLUDED.display_name,
    role = EXCLUDED.role,
    can_manage_missions = true,
    can_manage_stream = true,
    can_manage_photos = true,
    can_manage_awards = true,
    can_manage_guide = true,
    can_manage_participants = true;
END $$;

SELECT a.display_name, a.role, u.email
FROM public.admin_users a
JOIN auth.users u ON u.id = a.auth_user_id
JOIN public.events e ON e.id = a.event_id
WHERE e.name = 'Outing 2026';
