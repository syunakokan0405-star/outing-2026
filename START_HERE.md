# OUTING 2026 — Start here

This ZIP is aligned to the Supabase project where migrations 001–008 were already run successfully.

## Before starting the app
1. In Supabase SQL Editor, run `supabase/migrations/009_app_alignment_and_runtime_fixes.sql`.
2. In Supabase Project Settings > API, copy the Project URL and Publishable key.
3. Copy `.env.example` to `.env.local`.
4. Fill:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `NEXT_PUBLIC_EVENT_ID` (the UUID of the Outing 2026 row)
5. Run:
   - `npm install`
   - `npm run typecheck`
   - `npm run dev`
6. Open http://localhost:3000/join and claim one of the test participants.

The app reuses `client_request_id` for retries and stores pending compressed photos in IndexedDB.
