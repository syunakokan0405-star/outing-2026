-- OUTING 2026 local/staging test data
-- Safe to re-run. Intended for a fresh development Supabase project.
-- Do NOT run this on production after the real participant roster is loaded.

DO $$
DECLARE
  v_event_id uuid;
BEGIN
  SELECT id INTO v_event_id
  FROM public.events
  WHERE name = 'Outing 2026'
  ORDER BY created_at
  LIMIT 1;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Outing 2026 event not found. Run migrations 001-005 first.';
  END IF;

  INSERT INTO public.participants (event_id, name)
  VALUES
    (v_event_id, 'テスト 01'),
    (v_event_id, 'テスト 02'),
    (v_event_id, 'テスト 03'),
    (v_event_id, 'テスト 04'),
    (v_event_id, 'テスト 05'),
    (v_event_id, 'テスト 06'),
    (v_event_id, 'テスト 07'),
    (v_event_id, 'テスト 08'),
    (v_event_id, 'テスト 09'),
    (v_event_id, 'テスト 10'),
    (v_event_id, 'テスト 11'),
    (v_event_id, 'テスト 12'),
    (v_event_id, 'テスト 13'),
    (v_event_id, 'テスト 14'),
    (v_event_id, 'テスト 15')
  ON CONFLICT (event_id, name) DO NOTHING;

  -- Initial guide data. We only insert these headings once.
  INSERT INTO public.guide_sections (event_id, section_type, title, body, sort_order)
  SELECT v_event_id, x.section_type, x.title, x.body, x.sort_order
  FROM (VALUES
    ('packing'::text, '持ち物', 'スマホ、充電器、飲み物、タオル、着替えなど。正式なしおり確定後に管理画面から更新。', 10),
    ('rules'::text, '注意事項', '集合時間を守ること。写真撮影では相手の意思とプライバシーに配慮すること。', 20),
    ('place'::text, '施設・集合場所', '正式な集合場所・施設案内は確定後に更新。', 30),
    ('groups'::text, '班分け', '正式な班分けはしおり確定後に掲載。', 40)
  ) AS x(section_type, title, body, sort_order)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.guide_sections g
    WHERE g.event_id = v_event_id AND g.title = x.title
  );

  -- Placeholder schedule for integration testing only.
  IF NOT EXISTS (SELECT 1 FROM public.schedule_items WHERE event_id = v_event_id) THEN
    INSERT INTO public.schedule_items (event_id, title, description, location, starts_at, ends_at, sort_order)
    VALUES
      (v_event_id, '集合・出発', 'テスト用予定。正式時刻に差し替えてください。', '集合場所（仮）', '2026-10-25 13:00:00+09', '2026-10-25 13:30:00+09', 10),
      (v_event_id, '交流会', 'テスト用予定。', '多目的ホール（仮）', '2026-10-25 15:00:00+09', '2026-10-25 17:00:00+09', 20),
      (v_event_id, 'Night Event', 'テスト用予定。', '多目的ホール（仮）', '2026-10-25 20:00:00+09', '2026-10-25 22:00:00+09', 30),
      (v_event_id, '朝食', 'テスト用予定。', '食堂（仮）', '2026-10-26 07:30:00+09', '2026-10-26 08:30:00+09', 40),
      (v_event_id, '解散', 'テスト用予定。', '集合場所（仮）', '2026-10-26 13:00:00+09', '2026-10-26 13:30:00+09', 50);
  END IF;
END $$;

-- Return the event UUID for .env.local.
SELECT id AS event_id, name, status, starts_at, ends_at
FROM public.events
WHERE name = 'Outing 2026'
ORDER BY created_at
LIMIT 1;
