-- AI provider observability columns for score_history.
-- Nullable; old rows stay null. wa_audit_log uses its existing metadata jsonb.

alter table public.score_history
  add column if not exists ai_provider text,
  add column if not exists model_used text;

create index if not exists idx_score_history_ai_provider
  on public.score_history (ai_provider, scored_at desc)
  where ai_provider is not null;
