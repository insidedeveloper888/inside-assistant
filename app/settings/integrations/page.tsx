"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type GithubStatus =
  | { connected: false }
  | { connected: true; github_login: string; connected_at: string; repos: { full_name: string; private: boolean }[] };

type LarkStatus =
  | { connected: false }
  | { connected: true; name: string | null; open_id: string | null; connected_at: string };

type Job = {
  id: string;
  job_type: string;
  name: string | null;
  cron: string;
  timezone: string | null;
  config: Record<string, unknown>;
  is_enabled: boolean;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
};

type TeamMember = { user_id: string; display_name: string | null; lark_name: string | null; lark_open_id: string | null };

export default function IntegrationsPage() {
  const [gh, setGh] = useState<GithubStatus | null>(null);
  const [pat, setPat] = useState("");
  const [patError, setPatError] = useState("");
  const [patSaving, setPatSaving] = useState(false);

  const [lark, setLark] = useState<LarkStatus | null>(null);
  const [larkToken, setLarkToken] = useState("");
  const [larkError, setLarkError] = useState("");
  const [larkSaving, setLarkSaving] = useState(false);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  // Create-job form state
  const [newJob, setNewJob] = useState({
    name: "Daily GitHub digest",
    cron: "0 8 * * *",
    repos: [] as string[],
    recipients: [] as string[], // lark_open_ids
    lookback_hours: 24,
  });

  async function loadGh() {
    const res = await fetch("/api/integrations/github/connect");
    setGh(await res.json());
  }
  async function loadLark() {
    const res = await fetch("/api/integrations/lark-user/connect");
    setLark(await res.json());
  }
  async function saveLark() {
    setLarkSaving(true);
    setLarkError("");
    const res = await fetch("/api/integrations/lark-user/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: larkToken }),
    });
    const data = await res.json();
    setLarkSaving(false);
    if (!res.ok) {
      setLarkError(data.error || "Failed");
      return;
    }
    setLarkToken("");
    loadLark();
  }
  async function disconnectLark() {
    if (!confirm("Disconnect your personal Lark token? 'Save to Lark' button in chat will stop working.")) return;
    await fetch("/api/integrations/lark-user/connect", { method: "DELETE" });
    loadLark();
  }
  async function loadJobs() {
    const res = await fetch("/api/automations");
    const data = await res.json();
    setJobs(data.jobs ?? []);
  }
  async function loadTeam() {
    const res = await fetch("/api/admin/team");
    if (res.status === 403) return; // non-directors can't load team
    const data = await res.json();
    setTeam(data.members ?? []);
  }

  useEffect(() => {
    loadGh();
    loadLark();
    loadJobs();
    loadTeam();
  }, []);

  async function savePAT() {
    setPatSaving(true);
    setPatError("");
    const res = await fetch("/api/integrations/github/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: pat }),
    });
    const data = await res.json();
    setPatSaving(false);
    if (!res.ok) {
      setPatError(data.error || "Failed");
      return;
    }
    setPat("");
    loadGh();
  }

  async function disconnectGh() {
    if (!confirm("Disconnect GitHub? Scheduled GitHub digests will start failing.")) return;
    await fetch("/api/integrations/github/connect", { method: "DELETE" });
    loadGh();
  }

  async function createJob() {
    if (!newJob.repos.length) return alert("Pick at least one repo");
    if (!newJob.recipients.length) return alert("Pick at least one recipient");

    const recipientsData = team
      .filter((m) => m.lark_open_id && newJob.recipients.includes(m.lark_open_id))
      .map((m) => ({ lark_open_id: m.lark_open_id!, name: m.lark_name || m.display_name || "" }));

    const res = await fetch("/api/automations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        job_type: "github-digest",
        name: newJob.name,
        cron: newJob.cron,
        config: {
          repos: newJob.repos,
          recipients: recipientsData,
          lookback_hours: newJob.lookback_hours,
        },
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Failed");
      return;
    }
    setShowCreate(false);
    setNewJob({ name: "Daily GitHub digest", cron: "0 8 * * *", repos: [], recipients: [], lookback_hours: 24 });
    loadJobs();
  }

  async function toggleJob(id: string, current: boolean) {
    await fetch("/api/automations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle", id, is_enabled: !current }),
    });
    loadJobs();
  }

  async function deleteJob(id: string) {
    if (!confirm("Delete this job permanently?")) return;
    await fetch("/api/automations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    loadJobs();
  }

  const [runningId, setRunningId] = useState<string | null>(null);
  const [lastRunOutput, setLastRunOutput] = useState<{ id: string; text: string; error?: boolean } | null>(null);

  async function runNow(id: string) {
    setRunningId(id);
    setLastRunOutput(null);
    try {
      const res = await fetch(`/api/automations/${id}/run`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setLastRunOutput({ id, text: data.error || "Run failed", error: true });
      } else {
        setLastRunOutput({ id, text: data.output || "Done (no output)" });
      }
      loadJobs();
    } catch (err) {
      setLastRunOutput({ id, text: err instanceof Error ? err.message : "Network error", error: true });
    } finally {
      setRunningId(null);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
      <div className="mx-auto max-w-4xl space-y-10">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Integrations & Automations</h1>
          <Link href="/chat" className="text-xs text-zinc-500 hover:text-zinc-300">← Back to Chat</Link>
        </div>

        {/* GitHub section */}
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="text-base font-medium">GitHub</h2>
              <p className="mt-1 text-xs text-zinc-500">Connect your GitHub account so the AI can read commits and PRs.</p>
            </div>
            {gh?.connected && (
              <button onClick={disconnectGh} className="rounded bg-red-900/40 px-3 py-1 text-xs text-red-300 hover:bg-red-900/60">
                Disconnect
              </button>
            )}
          </div>

          {gh === null && <p className="text-xs text-zinc-500">Loading…</p>}

          {gh?.connected === false && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-400">
                Create a Personal Access Token at{" "}
                <a className="text-indigo-400 hover:underline" target="_blank" rel="noreferrer" href="https://github.com/settings/tokens/new?scopes=repo,read:user&description=Inside%20Assistant">
                  github.com/settings/tokens/new
                </a>
                {" "}with <code className="rounded bg-zinc-800 px-1">repo</code> scope, then paste below.
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  placeholder="ghp_..."
                  className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                />
                <button
                  onClick={savePAT}
                  disabled={patSaving || pat.length < 20}
                  className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {patSaving ? "Connecting…" : "Connect"}
                </button>
              </div>
              {patError && <p className="text-xs text-red-400">{patError}</p>}
            </div>
          )}

          {gh?.connected && (
            <div className="space-y-2 text-xs text-zinc-400">
              <p>
                ✓ Connected as <span className="font-medium text-emerald-400">{gh.github_login}</span>
                {" "}since {new Date(gh.connected_at).toLocaleDateString()}
              </p>
              <p>{gh.repos.length} repos accessible.</p>
            </div>
          )}
        </section>

        {/* Lark (personal) section */}
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="text-base font-medium">Lark (Personal)</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Connect YOUR Lark account so the AI can create docs under your name from Personal chat.
                This is scoped to you only — other team members cannot access your Lark account through this.
              </p>
            </div>
            {lark?.connected && (
              <button onClick={disconnectLark} className="rounded bg-red-900/40 px-3 py-1 text-xs text-red-300 hover:bg-red-900/60">
                Disconnect
              </button>
            )}
          </div>

          {lark === null && <p className="text-xs text-zinc-500">Loading…</p>}

          {lark?.connected === false && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-400">
                Get a user access token from{" "}
                <a className="text-indigo-400 hover:underline" target="_blank" rel="noreferrer"
                   href="https://open.larksuite.com/app">
                  Lark Open Platform
                </a>
                {" "}→ your app → Development Config → Issue a user token. Required scopes:
                {" "}<code className="rounded bg-zinc-800 px-1">docx:document</code>,
                {" "}<code className="rounded bg-zinc-800 px-1">drive:drive</code>.
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={larkToken}
                  onChange={(e) => setLarkToken(e.target.value)}
                  placeholder="u-..."
                  className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                />
                <button
                  onClick={saveLark}
                  disabled={larkSaving || larkToken.length < 20}
                  className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {larkSaving ? "Connecting…" : "Connect"}
                </button>
              </div>
              {larkError && <p className="text-xs text-red-400">{larkError}</p>}
            </div>
          )}

          {lark?.connected && (
            <div className="space-y-1 text-xs text-zinc-400">
              <p>
                ✓ Connected as <span className="font-medium text-emerald-400">{lark.name ?? "(unnamed)"}</span>
                {" "}since {new Date(lark.connected_at).toLocaleDateString()}
              </p>
              <p className="text-zinc-500">
                In Personal chat, the AI reply now shows a
                <span className="mx-1 rounded-full bg-blue-500/20 px-1.5 py-0.5 text-[9px] text-blue-300">📝 Save to Lark</span>
                button — click it to materialize that reply as a Lark doc.
              </p>
            </div>
          )}
        </section>

        {/* Automations section */}
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="text-base font-medium">Scheduled Automations</h2>
              <p className="mt-1 text-xs text-zinc-500">Recurring jobs that run on your behalf — daily digests, reminders, etc.</p>
            </div>
            {gh?.connected && (
              <button
                onClick={() => setShowCreate((v) => !v)}
                className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-500"
              >
                {showCreate ? "Cancel" : "+ New Job"}
              </button>
            )}
          </div>

          {!gh?.connected && (
            <p className="text-xs text-zinc-500">Connect GitHub above to create a GitHub digest job.</p>
          )}

          {showCreate && gh?.connected && (
            <div className="mb-5 space-y-3 rounded border border-zinc-700 bg-zinc-800/50 p-4">
              <div>
                <label className="block text-xs text-zinc-400">Name</label>
                <input
                  value={newJob.name}
                  onChange={(e) => setNewJob({ ...newJob, name: e.target.value })}
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400">Schedule (cron, Asia/Kuala_Lumpur)</label>
                <input
                  value={newJob.cron}
                  onChange={(e) => setNewJob({ ...newJob, cron: e.target.value })}
                  placeholder="0 8 * * *"
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 font-mono text-sm text-white outline-none"
                />
                <p className="mt-1 text-[10px] text-zinc-500">
                  Examples: <code>0 8 * * *</code> daily 8am • <code>0 9 * * 1-5</code> weekdays 9am
                </p>
              </div>
              <div>
                <label className="block text-xs text-zinc-400">Repos to watch</label>
                <div className="mt-1 max-h-40 overflow-y-auto rounded border border-zinc-700 bg-zinc-900 p-2">
                  {gh.repos.map((r) => (
                    <label key={r.full_name} className="flex items-center gap-2 py-0.5 text-xs">
                      <input
                        type="checkbox"
                        checked={newJob.repos.includes(r.full_name)}
                        onChange={(e) => {
                          setNewJob({
                            ...newJob,
                            repos: e.target.checked
                              ? [...newJob.repos, r.full_name]
                              : newJob.repos.filter((x) => x !== r.full_name),
                          });
                        }}
                      />
                      <span>{r.full_name}</span>
                      {r.private && <span className="rounded bg-amber-900/40 px-1 text-[9px] text-amber-300">private</span>}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-zinc-400">Recipients (Lark DM)</label>
                <div className="mt-1 max-h-32 overflow-y-auto rounded border border-zinc-700 bg-zinc-900 p-2">
                  {team.filter((m) => m.lark_open_id).map((m) => (
                    <label key={m.user_id} className="flex items-center gap-2 py-0.5 text-xs">
                      <input
                        type="checkbox"
                        checked={newJob.recipients.includes(m.lark_open_id!)}
                        onChange={(e) => {
                          setNewJob({
                            ...newJob,
                            recipients: e.target.checked
                              ? [...newJob.recipients, m.lark_open_id!]
                              : newJob.recipients.filter((x) => x !== m.lark_open_id),
                          });
                        }}
                      />
                      <span>{m.lark_name || m.display_name || "—"}</span>
                    </label>
                  ))}
                  {team.length === 0 && <p className="text-[10px] text-zinc-500">No team members (or you're not a director to see them)</p>}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowCreate(false)} className="rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-200">Cancel</button>
                <button onClick={createJob} className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-500">Create</button>
              </div>
            </div>
          )}

          {jobs.length === 0 ? (
            <p className="text-xs text-zinc-500">No scheduled jobs yet.</p>
          ) : (
            <div className="space-y-2">
              {jobs.map((j) => (
                <div key={j.id}>
                <div className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{j.name || j.job_type}</span>
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{j.job_type}</span>
                      {j.last_status === "error" && <span className="rounded bg-red-900/40 px-1.5 py-0.5 text-[10px] text-red-300">last run: error</span>}
                      {j.last_status === "success" && <span className="rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] text-emerald-300">last run: ok</span>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-[11px] text-zinc-500">
                      <span className="font-mono">{j.cron}</span>
                      <span>{j.timezone}</span>
                      {j.last_run_at && <span>last: {new Date(j.last_run_at).toLocaleString()}</span>}
                    </div>
                    {j.last_error && <p className="mt-1 text-[10px] text-red-400">{j.last_error}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => runNow(j.id)}
                      disabled={runningId === j.id}
                      className="rounded bg-indigo-900/40 px-2 py-1 text-[10px] text-indigo-300 hover:bg-indigo-900/60 disabled:opacity-50"
                    >
                      {runningId === j.id ? "Running…" : "▶ Run Now"}
                    </button>
                    <button
                      onClick={() => toggleJob(j.id, j.is_enabled)}
                      className={`rounded px-2 py-1 text-[10px] ${
                        j.is_enabled
                          ? "bg-emerald-900/40 text-emerald-300 hover:bg-emerald-900/60"
                          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                      }`}
                    >
                      {j.is_enabled ? "Active" : "Paused"}
                    </button>
                    <button
                      onClick={() => deleteJob(j.id)}
                      className="rounded px-2 py-1 text-[10px] text-red-500/70 hover:bg-red-900/30 hover:text-red-400"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {lastRunOutput?.id === j.id && (
                  <div className={`mt-1 rounded px-3 py-2 text-[11px] ${
                    lastRunOutput.error ? "bg-red-950/50 text-red-300" : "bg-emerald-950/50 text-emerald-300"
                  }`}>
                    {lastRunOutput.text}
                  </div>
                )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
