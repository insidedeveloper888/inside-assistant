-- Backfill memory_route on historical assistant_messages rows so the
-- 🏢 Company / 🔒 Personal badge renders correctly on older chats.
--
-- Strategy: infer route from the session's mode (assistant_sessions.mode).
-- Only touches rows where memory_route IS NULL (idempotent).
-- User messages never get a route (the badge only shows on assistant replies).

UPDATE assistant_messages m
SET memory_route = CASE
  WHEN s.mode = 'company' THEN 'company'
  ELSE 'personal'
END
FROM assistant_sessions s
WHERE m.session_id = s.id
  AND m.role = 'assistant'
  AND m.memory_route IS NULL;

-- Sanity: count remaining NULL rows (should be 0 or only user rows)
-- SELECT role, COUNT(*) FROM assistant_messages WHERE memory_route IS NULL GROUP BY role;
