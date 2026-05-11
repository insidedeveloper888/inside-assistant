-- Single source of truth for "who is this user and what can they do".
--
-- Before this migration, callers were reconstructing identity + capabilities
-- at every callsite through brittle multi-hop joins:
--
--   ai_reply_whitelist (by phone)
--     → lark_open_id
--     → user_integrations(provider='lark_user', external_id=lark_open_id)
--     → user_id
--     → user_integrations(provider='google', user_id=user_id)
--
-- Whenever any hop's row didn't exist (e.g. Lark linked via /admin Members
-- picker, not OAuth) the bridge broke and the WhatsApp AI silently lost
-- visibility into integrations the user genuinely had connected on the web.
--
-- This view is the canonical answer to every "is X connected for this user"
-- question. Both the web (`/settings/integrations` badges, `/admin` member
-- table) and the WhatsApp handler (system prompt construction) read it.
--
-- Two distinct concepts are exposed:
--   - has_<provider>     : "the AI can act AS this user on <provider>" —
--                          requires an OAuth row in user_integrations
--                          with a non-null external_id (i.e. real tokens).
--   - lark_identity_known: "we know this user's Lark open_id" — admin-set
--                          OR OAuth. Sufficient for @-mention / attendees,
--                          NOT sufficient for acting on their behalf.
--
-- The web shows ✓ Connected only when has_<provider> = true.
-- The prompt builder advertises a tool only when has_<provider> = true.
-- For Lark attendees, the prompt-side roster uses lark_identity_known.

create or replace view public.v_user_capabilities as
select
  s.user_id,
  s.phone,
  s.email,
  s.display_name,
  s.role,
  s.lark_open_id,
  s.lark_name,
  s.lark_verified,
  s.claude_md,
  -- Capability flags: TRUE iff an OAuth row exists with valid external_id
  exists (
    select 1 from public.user_integrations i
    where i.user_id = s.user_id
      and i.provider = 'google'
      and i.external_id is not null
  ) as has_google,
  exists (
    select 1 from public.user_integrations i
    where i.user_id = s.user_id
      and i.provider = 'lark_user'
      and i.external_id is not null
  ) as has_lark,
  exists (
    select 1 from public.user_integrations i
    where i.user_id = s.user_id
      and i.provider = 'github'
      and i.external_id is not null
  ) as has_github,
  -- Identity-known flag: admin-set or OAuth. Used for @-mention / attendees.
  (s.lark_open_id is not null) as lark_identity_known
from public.assistant_user_settings s;

comment on view public.v_user_capabilities is
  'Single source of truth for per-user integration capabilities. Read by both the web (connected badges) and the WhatsApp handler (prompt building).';


-- RPC: resolve capabilities by phone. The WhatsApp handler receives a phone
-- and needs the full capability bundle in one round-trip. This wraps the
-- whitelist → settings join so the handler doesn't reconstruct it.
--
-- Returns the same shape as v_user_capabilities. If no user is found for
-- the phone, returns no rows (caller handles).

create or replace function public.get_capabilities_by_phone(p_phone text)
returns setof public.v_user_capabilities
language sql
stable
security definer
set search_path = public
as $$
  -- Normalize: strip non-digits so '+60-162-193-255' matches '60162193255'
  with normalized as (
    select regexp_replace(p_phone, '\D', '', 'g') as phone
  )
  select v.*
  from public.v_user_capabilities v, normalized n
  where regexp_replace(coalesce(v.phone, ''), '\D', '', 'g') = n.phone
  limit 1;
$$;

comment on function public.get_capabilities_by_phone(text) is
  'Returns the capability bundle for the user owning this phone (digit-normalized). Used by the WhatsApp webhook to build the system prompt.';


-- Allow the service role (used by both the web SSR and the webhook handler)
-- to call the RPC. Anon/authenticated do NOT get this — it leaks role.
revoke all on function public.get_capabilities_by_phone(text) from public;
grant execute on function public.get_capabilities_by_phone(text) to service_role;

-- View is readable by service_role for the same reason.
revoke all on public.v_user_capabilities from public;
grant select on public.v_user_capabilities to service_role, authenticated;
-- authenticated users can see ONLY their own row via RLS-friendly views.
-- The view itself doesn't enforce that — callers must filter by user_id
-- when querying as `authenticated` (the standard pattern in this codebase).
