-- Default scoring OFF for new tenants. Each tenant flips it on themselves
-- via WA Analyzer → Settings → Scoring → toggle. The default-on behavior
-- was bleeding tokens for tenants who never asked for it.
--
-- Also retroactively disabled all 5 tenants who had it still on as of
-- 2026-05-23 (Inside Advisory + Inside Assistant were already off).
-- Already applied to production via psql.

alter table public.tenants
  alter column scoring_enabled set default false;

-- One-time flip for everyone currently on. Idempotent — no-op on re-run.
update public.tenants set scoring_enabled = false where scoring_enabled = true;
