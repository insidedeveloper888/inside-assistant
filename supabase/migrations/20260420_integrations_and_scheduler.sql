-- Integrations + scheduler tables
-- Safe to run multiple times (IF NOT EXISTS everywhere).

-- Per-user OAuth tokens & integration config.
-- Encryption: tokens stored as-is here; app layer encrypts before write / decrypts on read
-- using a MASTER_KEY env var (AES-GCM). pgsodium column encryption can be layered later.
CREATE TABLE IF NOT EXISTS user_integrations (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,                -- 'github', 'google', 'lark_user'
  access_token text,                     -- encrypted at app layer
  refresh_token text,                    -- encrypted at app layer
  scopes text[],
  expires_at timestamptz,
  external_id text,                      -- GitHub login, Google sub, Lark open_id
  config jsonb DEFAULT '{}'::jsonb,      -- per-provider user config
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);

CREATE INDEX IF NOT EXISTS user_integrations_provider_idx ON user_integrations(provider);

-- Scheduled job definitions. Scheduler service polls this every minute.
-- job_type maps to a handler registered in the scheduler; config jsonb carries
-- handler-specific params (repos, recipients, cron, etc).
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_type text NOT NULL,                -- 'github-digest', 'calendar-brief', 'lark-daily'
  name text,                             -- user-friendly label
  cron text NOT NULL,                    -- standard cron expression, e.g. '0 8 * * *'
  timezone text DEFAULT 'Asia/Kuala_Lumpur',
  config jsonb DEFAULT '{}'::jsonb,      -- {repos:[...], recipients:[...], etc}
  is_enabled boolean DEFAULT true,
  last_run_at timestamptz,
  last_status text,                      -- 'success' | 'error' | null
  last_error text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scheduled_jobs_user_idx ON scheduled_jobs(user_id);
CREATE INDEX IF NOT EXISTS scheduled_jobs_enabled_idx ON scheduled_jobs(is_enabled) WHERE is_enabled = true;

-- Execution log for observability + debugging.
CREATE TABLE IF NOT EXISTS scheduled_job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES scheduled_jobs(id) ON DELETE CASCADE,
  started_at timestamptz DEFAULT now(),
  finished_at timestamptz,
  status text,                           -- 'success' | 'error'
  output text,                           -- summary of what was done
  error text,
  duration_ms integer
);

CREATE INDEX IF NOT EXISTS scheduled_job_runs_job_idx ON scheduled_job_runs(job_id, started_at DESC);

-- Tool-call audit log (so we can see which AI triggered which third-party action).
-- Useful for debugging, cost tracking, and revoking if something goes wrong.
CREATE TABLE IF NOT EXISTS tool_invocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id uuid,                       -- chat session or null for scheduled
  tool_name text NOT NULL,               -- 'lark_create_doc', 'github_commits', etc
  provider text,                         -- 'lark', 'github', 'google'
  input jsonb,
  output jsonb,
  status text,                           -- 'success' | 'error'
  error text,
  duration_ms integer,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tool_invocations_user_idx ON tool_invocations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tool_invocations_tool_idx ON tool_invocations(tool_name);

-- RLS: these tables are only touched by service_role + scheduler; disable RLS for now.
-- Enable and write policies when we expose any of this via anon/authenticated client.
ALTER TABLE user_integrations DISABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_job_runs DISABLE ROW LEVEL SECURITY;
ALTER TABLE tool_invocations DISABLE ROW LEVEL SECURITY;
