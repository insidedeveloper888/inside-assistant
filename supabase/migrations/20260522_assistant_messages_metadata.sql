-- Add metadata jsonb to assistant_messages so /api/chat can record which
-- provider/model produced each assistant reply. Mirrors the provider
-- tracking we already do for score_history and wa_audit_log — gives us
-- one consistent "which model answered this" view across all three
-- surfaces.

alter table public.assistant_messages
  add column if not exists metadata jsonb;

create index if not exists idx_assistant_messages_provider
  on public.assistant_messages ((metadata->>'provider'))
  where metadata is not null and role = 'assistant';
