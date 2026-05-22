-- Atomic claim function for the scoring_queue.
--
-- Replaces the previous select-then-update pattern that race-condition'd
-- when scoring-engine scaled to multiple replicas on Zeabur. Each replica
-- would SELECT the same status=pending rows and all process them — one
-- queue row produced N score_history rows. On May 22 we observed 17
-- queue rows generate 1,198 scores (~70x amplification) in 12 hours.
--
-- The FOR UPDATE SKIP LOCKED clause means concurrent callers SKIP any
-- rows another caller has locked, so each row is claimed by exactly one
-- replica. Standard Postgres queueing pattern.
--
-- Already applied to production via psql.

create or replace function public.claim_scoring_jobs(p_batch_size int)
returns setof public.scoring_queue
language plpgsql
as $$
begin
  return query
  update public.scoring_queue q
  set status = 'processing',
      attempts = coalesce(attempts, 0) + 1,
      processed_at = null
  from (
    select id from public.scoring_queue
    where status = 'pending'
    order by created_at
    limit p_batch_size
    for update skip locked
  ) sub
  where q.id = sub.id
  returning q.*;
end;
$$;

grant execute on function public.claim_scoring_jobs(int) to service_role;
