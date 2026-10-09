Place the Phase 1 schema and Phase 2 functions/RLS SQL from the design conversation here before connecting Supabase.

## 007_reliability_consent_ranking.sql
Adds consent enforcement, idempotent post requests via `client_request_id`, immutable deletion audit logs, participant/admin/retention delete reasons, no automatic CLEAR promotion after deletion, tied point rankings, and heart Top10 rankings.

## 008_security_storage_cleanup.sql
Restricts ranking RPCs to event members/admins and adds Storage DELETE policies for post owners and photo admins.

## 013_admin_management.sql
Apply in Supabase SQL Editor **after 012 and before deploying this branch**.
Adds retry-safe manual point adjustments, stored reasons and operator names,
adjustment revocation, participant-filtered photo lists, reversible administrative
post cancellation, and mission title editing with conflict detection.

Point adjustment and history require owner/admin. Photo cancellation/restoration
requires photo management permission; title editing requires mission management
permission. Participant-management staff do not gain these permissions implicitly.

Administrative cancellation preserves image bytes and revokes the post's active
points (including mention rewards). Only cancellation through the new tool is
restorable. Existing permanent deletions and participant deletions are not
restorable. Restoration reactivates the original reward transactions only when
the original first-clear assignment remains uncleared; a newer mission clear
causes photo-only restoration. Normal 90-day retention still applies.

The new administrator image URL endpoint uses the existing server-side
`SUPABASE_SERVICE_ROLE_KEY` after validating the logged-in administrator and
photo permission, and scopes all lookups to `NEXT_PUBLIC_EVENT_ID`. R2 credentials
are unchanged. Never expose the service-role key in a NEXT_PUBLIC variable.

Verification: `npm test`, `npm run typecheck`, `npm run build`. Database regression
tests execute PostgreSQL functions locally through PGlite; they do not access or
modify the production Supabase project. Production acceptance: adjust and revoke
points, cancel/restore a test photo, re-clear before restoration, and edit one
mission title as an authorized administrator.
