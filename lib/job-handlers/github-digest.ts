/**
 * GitHub daily digest — executes in the Next.js API route for manual "Run Now" triggers.
 * This mirrors services/scheduler/src/handlers/github-digest.ts so both the
 * scheduler (cron-driven) and the web UI (one-shot) can run it.
 *
 * If the logic diverges between the two files it'll be a subtle bug — keep in sync
 * or extract into a shared package when the duplication becomes painful.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Job = {
  id: string;
  user_id: string;
  config: Record<string, unknown>;
};

type DigestConfig = {
  repos: string[];
  recipients: { lark_open_id: string; name: string }[];
  lookback_hours?: number;
};

export async function runGithubDigest(job: Job, supabase: SupabaseClient): Promise<string> {
  const CLAUDE_PROXY_URL = process.env.CLAUDE_PROXY_URL || "";
  const CLAUDE_PROXY_API_KEY = process.env.CLAUDE_PROXY_API_KEY || "";
  const LARK_APP_ID = process.env.LARK_APP_ID || "";
  const LARK_APP_SECRET = process.env.LARK_APP_SECRET || "";
  const COMPANY_MEMORY_URL = process.env.COMPANY_MEMORY_URL || "";
  const COMPANY_MEMORY_API_KEY = process.env.COMPANY_MEMORY_API_KEY || "";

  const config = job.config as DigestConfig;
  if (!config?.repos?.length || !config?.recipients?.length) {
    throw new Error("config.repos and config.recipients are required");
  }

  const { data: integration } = await supabase
    .from("user_integrations")
    .select("access_token")
    .eq("user_id", job.user_id)
    .eq("provider", "github")
    .single();

  if (!integration?.access_token) {
    throw new Error("user has no GitHub integration — connect one first");
  }

  const token = integration.access_token as string;
  const lookback = config.lookback_hours ?? 24;
  const since = new Date(Date.now() - lookback * 3600_000).toISOString();

  const repoData = await Promise.all(config.repos.map(async (repo) => {
    const [commits, prs] = await Promise.all([
      fetchCommits(repo, token, since),
      fetchPullRequests(repo, token, since),
    ]);
    return { repo, commits, prs };
  }));

  const totalCommits = repoData.reduce((n, r) => n + r.commits.length, 0);
  const totalPRs = repoData.reduce((n, r) => n + r.prs.length, 0);

  if (totalCommits === 0 && totalPRs === 0) {
    return `No activity across ${config.repos.length} repo(s) in the past ${lookback}h`;
  }

  const rawActivity = repoData.map(({ repo, commits, prs }) => {
    const commitLines = commits.map((c) => `  - [${c.sha.slice(0, 7)}] ${c.author}: ${c.message.split("\n")[0]}`);
    const prLines = prs.map((p) => `  - PR #${p.number} (${p.state}${p.merged_at ? ", merged" : ""}) by ${p.author}: ${p.title}`);
    return `## ${repo}\n${commitLines.length ? `Commits:\n${commitLines.join("\n")}` : "No commits"}\n${prLines.length ? `PRs:\n${prLines.join("\n")}` : "No PRs"}`;
  }).join("\n\n");

  const summary = await summarizeViaClaude(rawActivity, lookback, CLAUDE_PROXY_URL, CLAUDE_PROXY_API_KEY);

  const larkToken = await getLarkToken(LARK_APP_ID, LARK_APP_SECRET);
  if (!larkToken) {
    console.warn("[github-digest] Lark token unavailable — check LARK_APP_ID / LARK_APP_SECRET env in Vercel");
  }
  let delivered = 0;
  const deliveryErrors: string[] = [];
  for (const r of config.recipients) {
    if (!r.lark_open_id) {
      deliveryErrors.push(`${r.name}: no lark_open_id`);
      continue;
    }
    const { ok, detail } = await sendLarkDigest(larkToken, r.lark_open_id, summary, lookback);
    if (ok) delivered++;
    else deliveryErrors.push(`${r.name}: ${detail}`);
  }

  if (COMPANY_MEMORY_URL) {
    try {
      await fetch(`${COMPANY_MEMORY_URL}/api/memories`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(COMPANY_MEMORY_API_KEY ? { "X-API-Key": COMPANY_MEMORY_API_KEY } : {}),
        },
        body: JSON.stringify({
          content: `# GitHub Digest (${new Date().toISOString().slice(0, 10)})\n\n${summary}\n\n---\nRaw activity:\n${rawActivity}`,
          tags: ["daily-digest", "github", `date:${new Date().toISOString().slice(0, 10)}`],
          metadata: { job_id: job.id, repos: config.repos, commits: totalCommits, prs: totalPRs },
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {}
  }

  const errLine = deliveryErrors.length ? `\nDelivery errors: ${deliveryErrors.join("; ")}` : "";
  return `Delivered digest to ${delivered}/${config.recipients.length} recipients. ${totalCommits} commits, ${totalPRs} PRs across ${config.repos.length} repo(s).${errLine}`;
}

async function fetchCommits(repo: string, token: string, since: string) {
  const res = await fetch(`https://api.github.com/repos/${repo}/commits?since=${since}&per_page=50`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    sha: string;
    commit: { message: string; author: { name: string; date: string } };
    author: { login?: string } | null;
    html_url: string;
  }[];
  return data.map((c) => ({
    sha: c.sha,
    message: c.commit.message,
    author: c.author?.login ?? c.commit.author.name,
    url: c.html_url,
    repo,
    timestamp: c.commit.author.date,
  }));
}

async function fetchPullRequests(repo: string, token: string, since: string) {
  const res = await fetch(`https://api.github.com/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=30`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    number: number;
    title: string;
    state: string;
    user: { login?: string } | null;
    html_url: string;
    merged_at: string | null;
    updated_at: string;
  }[];
  return data
    .filter((p) => p.updated_at >= since)
    .map((p) => ({
      number: p.number,
      title: p.title,
      state: p.state,
      author: p.user?.login ?? "unknown",
      url: p.html_url,
      repo,
      merged_at: p.merged_at,
      updated_at: p.updated_at,
    }));
}

async function summarizeViaClaude(raw: string, lookback: number, url: string, key: string): Promise<string> {
  if (!url) return `Raw activity (Claude proxy unavailable):\n\n${raw.slice(0, 2000)}`;

  const systemPrompt = `You are summarizing GitHub activity for a small engineering team. Group by person. Highlight:
- Who shipped what (top 2-3 items per person)
- Stalled PRs (open >48h without activity)
- Any notable commit themes

Use bullet lists under **Person** headers. Keep under 500 words. Include short commit/PR numbers as references.`;

  const res = await fetch(`${url}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "X-API-Key": key } : {}),
    },
    body: JSON.stringify({
      systemPrompt,
      messages: [{ role: "user", content: `Past ${lookback}h of activity:\n\n${raw}` }],
      sessionId: "scheduler-github-digest",
      userId: "scheduler",
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) return `Claude summarization failed (${res.status}). Raw:\n\n${raw.slice(0, 2000)}`;
  const data = (await res.json()) as { content?: string };
  return data.content ?? "No summary returned";
}

async function getLarkToken(appId: string, appSecret: string): Promise<string | null> {
  if (!appId || !appSecret) return null;
  try {
    const res = await fetch("https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const data = (await res.json()) as { tenant_access_token?: string };
    return data.tenant_access_token ?? null;
  } catch {
    return null;
  }
}

async function sendLarkDigest(
  token: string | null,
  openId: string,
  summary: string,
  lookback: number
): Promise<{ ok: boolean; detail: string }> {
  if (!token) return { ok: false, detail: "no Lark token (check LARK_APP_ID/SECRET env)" };
  try {
    const res = await fetch("https://open.larksuite.com/open-apis/im/v1/messages?receive_id_type=open_id", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        receive_id: openId,
        msg_type: "interactive",
        content: JSON.stringify({
          config: { wide_screen_mode: true },
          header: {
            title: { tag: "plain_text", content: `📊 GitHub Digest — past ${lookback}h` },
            template: "blue",
          },
          elements: [{ tag: "markdown", content: summary.slice(0, 5000) }],
        }),
      }),
    });
    if (res.ok) return { ok: true, detail: "sent" };
    const text = await res.text();
    return { ok: false, detail: `lark ${res.status}: ${text.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "unknown" };
  }
}
