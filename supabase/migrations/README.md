Place the Phase 1 schema and Phase 2 functions/RLS SQL from the design conversation here before connecting Supabase.

## 007_reliability_consent_ranking.sql
Adds consent enforcement, idempotent post requests via `client_request_id`, immutable deletion audit logs, participant/admin/retention delete reasons, no automatic CLEAR promotion after deletion, tied point rankings, and heart Top10 rankings.

## 008_security_storage_cleanup.sql
Restricts ranking RPCs to event members/admins and adds Storage DELETE policies for post owners and photo admins.
