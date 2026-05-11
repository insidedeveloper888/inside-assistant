"use client";

import { useEffect, useState } from "react";

type WaStatus = {
  status: "not_configured" | "qr_pending" | "connected" | "disconnected";
  phoneNumber?: string | null;
  qrCode?: string | null;
  updatedAt?: string | null;
};

type GithubStatus =
  | { connected: false }
  | { connected: true; github_login: string; connected_at: string; repos: { full_name: string; private: boolean }[] };

type LarkStatus =
  | { connected: false }
  | { connected: true; name: string | null; open_id: string | null; connected_at: string };

type GoogleStatus =
  | { connected: false }
  | { connected: true; email: string | null; name: string | null; connected_at: string };

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
  const [wa, setWa] = useState<WaStatus | null>(null);

  const [gh, setGh] = useState<GithubStatus | null>(null);
  const [pat, setPat] = useState("");
  const [patError, setPatError] = useState("");
  const [patSaving, setPatSaving] = useState(false);

  const [lark, setLark] = useState<LarkStatus | null>(null);
  const [larkToken, setLarkToken] = useState("");
  const [larkError, setLarkError] = useState("");
  const [larkSaving, setLarkSaving] = useState(false);

  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [googleError, setGoogleError] = useState("");

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

  async function loadWa() {
    const res = await fetch("/api/whatsapp/status");
    if (res.status === 403) {
      setWa({ status: "not_configured" });
      return;
    }
    setWa(await res.json());
  }

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
  async function loadGoogle() {
    const res = await fetch("/api/integrations/google/connect");
    setGoogle(await res.json());
  }
  async function disconnectGoogle() {
    if (!confirm("Disconnect Google Workspace? AI will lose access to Gmail, Calendar, Docs, etc.")) return;
    await fetch("/api/integrations/google/connect", { method: "DELETE" });
    loadGoogle();
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
    loadWa();
    loadGh();
    loadLark();
    loadGoogle();
    loadJobs();
    loadTeam();

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      const larkErr = url.searchParams.get("lark_error");
      if (larkErr) setLarkError(`OAuth failed: ${larkErr}`);
      const googleErr = url.searchParams.get("google_error");
      if (googleErr) setGoogleError(`OAuth failed: ${googleErr}`);
      if (url.searchParams.get("lark_connected") || larkErr || url.searchParams.get("google_connected") || googleErr) {
        url.searchParams.delete("lark_connected");
        url.searchParams.delete("lark_error");
        url.searchParams.delete("google_connected");
        url.searchParams.delete("google_error");
        window.history.replaceState({}, "", url.toString());
      }
    }
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
    <div className="p-6 lg:p-8">
      <div className="mx-auto max-w-4xl space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Integrations & Automations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect external accounts and schedule recurring jobs the AI runs on your behalf.
          </p>
        </div>

        {/* WhatsApp section — shared with WA Analyzer, read-only */}
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="mb-4">
            <h2 className="text-base font-medium">WhatsApp</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Shared instance with WA Analyzer. Whitelisted team members messaging this number get AI replies.
            </p>
          </div>

          {wa === null && <p className="text-xs text-muted-foreground">Loading…</p>}

          {(wa?.status === "not_configured" || wa?.status === "disconnected") && (
            <p className="text-xs text-amber-400">Not connected. Connect from the WA Analyzer dashboard.</p>
          )}

          {wa?.status === "qr_pending" && (
            <p className="text-xs text-amber-400">QR scan pending — complete the connection from WA Analyzer.</p>
          )}

          {wa?.status === "connected" && (
            <div className="space-y-2 text-xs text-muted-foreground">
              <p>
                ✓ Connected as <span className="font-medium font-mono text-emerald-400">{wa.phoneNumber}</span>
              </p>
              {wa.updatedAt && <p className="text-muted-foreground">Since {new Date(wa.updatedAt).toLocaleString()}</p>}
              <p className="text-muted-foreground/70">Manage connection from WA Analyzer dashboard.</p>
            </div>
          )}
        </section>

        {/* GitHub section */}
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="text-base font-medium">GitHub</h2>
              <p className="mt-1 text-xs text-muted-foreground">Connect your GitHub account so the AI can read commits and PRs.</p>
            </div>
            {gh?.connected && (
              <button onClick={disconnectGh} className="rounded bg-red-500/10 px-3 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/20">
                Disconnect
              </button>
            )}
          </div>

          {gh === null && <p className="text-xs text-muted-foreground">Loading…</p>}

          {gh?.connected === false && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Create a Personal Access Token at{" "}
                <a className="text-primary hover:underline" target="_blank" rel="noreferrer" href="https://github.com/settings/tokens/new?scopes=repo,read:user&description=Inside%20Assistant">
                  github.com/settings/tokens/new
                </a>
                {" "}with <code className="rounded bg-muted px-1">repo</code> scope, then paste below.
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  placeholder="ghp_..."
                  className="flex-1 rounded border border-border bg-muted px-3 py-2 text-sm text-white outline-none focus:border-primary"
                />
                <button
                  onClick={savePAT}
                  disabled={patSaving || pat.length < 20}
                  className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 shadow-sm disabled:opacity-50"
                >
                  {patSaving ? "Connecting…" : "Connect"}
                </button>
              </div>
              {patError && <p className="text-xs text-red-400">{patError}</p>}
            </div>
          )}

          {gh?.connected && (
            <div className="space-y-2 text-xs text-muted-foreground">
              <p>
                ✓ Connected as <span className="font-medium text-emerald-400">{gh.github_login}</span>
                {" "}since {new Date(gh.connected_at).toLocaleDateString()}
              </p>
              <p>{gh.repos.length} repos accessible.</p>
            </div>
          )}
        </section>

        {/* Lark (personal) section */}
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="text-base font-medium">Lark (Personal)</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Connect YOUR Lark account so the AI can create docs under your name from Personal chat.
                This is scoped to you only — other team members cannot access your Lark account through this.
              </p>
            </div>
            {lark?.connected && (
              <button onClick={disconnectLark} className="rounded bg-red-500/10 px-3 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/20">
                Disconnect
              </button>
            )}
          </div>

          {lark === null && <p className="text-xs text-muted-foreground">Loading…</p>}

          {lark?.connected === false && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Click Connect — you'll be sent to Lark to authorize. Scan the QR with your Lark mobile app
                or log in with your account. No token pasting required.
              </p>
              <a
                href="/api/integrations/lark-user/start"
                className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 shadow-sm"
              >
                Connect Lark →
              </a>
              {larkError && <p className="text-xs text-red-400">{larkError}</p>}
            </div>
          )}

          {lark?.connected && (
            <div className="space-y-2 text-xs text-muted-foreground">
              <p>
                ✓ Connected as <span className="font-medium text-emerald-400">{lark.name ?? "(unnamed)"}</span>
                {" "}since {new Date(lark.connected_at).toLocaleDateString()}
              </p>
              <p className="text-muted-foreground">
                In Personal chat, the AI reply now shows a
                <span className="mx-1 rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[9px] text-blue-600 dark:text-blue-300">📝 Save to Lark</span>
                button — click it to materialize that reply as a Lark doc.
              </p>
              <LarkPermissions />
              <LarkHealthCheck />
            </div>
          )}
        </section>

        {/* Google Workspace section */}
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="text-base font-medium">Google Workspace</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Connect your Google account for Calendar, Gmail, Docs, Sheets, Drive, and more.
              </p>
            </div>
            {google?.connected && (
              <button onClick={disconnectGoogle} className="rounded bg-red-500/10 px-3 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/20">
                Disconnect
              </button>
            )}
          </div>

          {google === null && <p className="text-xs text-muted-foreground">Loading…</p>}

          {google?.connected === false && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Click Connect — you'll be sent to Google to authorize access to Calendar, Gmail, Drive, Docs, Sheets, Contacts, Tasks, and Meet.
              </p>
              <a
                href="/api/integrations/google/start"
                className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 shadow-sm"
              >
                Connect Google →
              </a>
              {googleError && <p className="text-xs text-red-400">{googleError}</p>}
            </div>
          )}

          {google?.connected && (
            <div className="space-y-2 text-xs text-muted-foreground">
              <p>
                ✓ Connected as <span className="font-medium text-emerald-400">{google.email ?? google.name ?? "(unknown)"}</span>
                {" "}since {new Date(google.connected_at).toLocaleDateString()}
              </p>
              <GooglePermissions larkConnected={lark?.connected ?? false} />
              <GoogleHealthCheck />
            </div>
          )}
        </section>

        {/* Automations section */}
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="text-base font-medium">Scheduled Automations</h2>
              <p className="mt-1 text-xs text-muted-foreground">Recurring jobs that run on your behalf — daily digests, reminders, etc.</p>
            </div>
            {gh?.connected && (
              <button
                onClick={() => setShowCreate((v) => !v)}
                className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 shadow-sm"
              >
                {showCreate ? "Cancel" : "+ New Job"}
              </button>
            )}
          </div>

          {!gh?.connected && (
            <p className="text-xs text-muted-foreground">Connect GitHub above to create a GitHub digest job.</p>
          )}

          {showCreate && gh?.connected && (
            <div className="mb-5 space-y-3 rounded border border-border bg-muted/50 p-4">
              <div>
                <label className="block text-xs text-muted-foreground">Name</label>
                <input
                  value={newJob.name}
                  onChange={(e) => setNewJob({ ...newJob, name: e.target.value })}
                  className="mt-1 w-full rounded border border-border bg-card px-3 py-1.5 text-sm text-white outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground">Schedule (cron, Asia/Kuala_Lumpur)</label>
                <input
                  value={newJob.cron}
                  onChange={(e) => setNewJob({ ...newJob, cron: e.target.value })}
                  placeholder="0 8 * * *"
                  className="mt-1 w-full rounded border border-border bg-card px-3 py-1.5 font-mono text-sm text-white outline-none"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Examples: <code>0 8 * * *</code> daily 8am • <code>0 9 * * 1-5</code> weekdays 9am
                </p>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground">Repos to watch</label>
                <div className="mt-1 max-h-40 overflow-y-auto rounded border border-border bg-card p-2">
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
                      {r.private && <span className="rounded bg-amber-500/15 px-1 text-[9px] text-amber-700 dark:text-amber-300">private</span>}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground">Recipients (Lark DM)</label>
                <div className="mt-1 max-h-32 overflow-y-auto rounded border border-border bg-card p-2">
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
                  {team.length === 0 && <p className="text-[10px] text-muted-foreground">No team members (or you're not a director to see them)</p>}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowCreate(false)} className="rounded bg-muted/70 px-3 py-1.5 text-xs text-foreground">Cancel</button>
                <button onClick={createJob} className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 shadow-sm">Create</button>
              </div>
            </div>
          )}

          {jobs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No scheduled jobs yet.</p>
          ) : (
            <div className="space-y-2">
              {jobs.map((j) => (
                <div key={j.id}>
                <div className="flex items-center justify-between rounded border border-border bg-card px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{j.name || j.job_type}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{j.job_type}</span>
                      {j.last_status === "error" && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-600 dark:text-red-400">last run: error</span>}
                      {j.last_status === "success" && <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">last run: ok</span>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted-foreground">
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
                      className="rounded bg-primary/15 px-2 py-1 text-[10px] text-primary hover:bg-primary/25 disabled:opacity-50"
                    >
                      {runningId === j.id ? "Running…" : "▶ Run Now"}
                    </button>
                    <button
                      onClick={() => toggleJob(j.id, j.is_enabled)}
                      className={`rounded px-2 py-1 text-[10px] ${
                        j.is_enabled
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25"
                          : "bg-muted text-muted-foreground hover:bg-muted/70"
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
                    lastRunOutput.error ? "bg-red-500/10 text-red-600 dark:text-red-300" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
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

function LarkPermissions() {
  const [perms, setPerms] = useState<Record<string, boolean> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/integrations/lark-user/permissions")
      .then((r) => r.json())
      .then((d) => setPerms(d.permissions ?? null))
      .catch(() => {});
  }, []);

  async function toggle(key: string) {
    if (!perms) return;
    const updated = { ...perms, [key]: !perms[key] };
    setPerms(updated);
    setSaving(true);
    await fetch("/api/integrations/lark-user/permissions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permissions: updated }),
    });
    setSaving(false);
  }

  if (!perms) return null;

  const items = [
    { key: "calendar", label: "Calendar", desc: "View & create calendar events" },
    { key: "freebusy", label: "Busy Status", desc: "Others can see if you're busy" },
    { key: "docs", label: "Documents", desc: "Create Lark docs" },
    { key: "sheets", label: "Sheets", desc: "Create & edit spreadsheets" },
    { key: "drive", label: "Drive", desc: "Upload files to Lark Drive" },
    { key: "tasks", label: "Tasks", desc: "Create & manage tasks" },
    { key: "wiki", label: "Wiki", desc: "Access knowledge base" },
    { key: "im", label: "Messages", desc: "Read & send Lark messages" },
    { key: "whiteboard", label: "Whiteboard", desc: "Create whiteboards" },
  ];

  return (
    <div className="mt-3 rounded border border-border bg-card/60 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-foreground/80">Permissions</span>
        {saving && <span className="text-[10px] text-muted-foreground">Saving…</span>}
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <label key={item.key} className="flex items-center justify-between gap-3 cursor-pointer group">
            <div>
              <span className="text-xs text-foreground/80">{item.label}</span>
              <p className="text-[10px] text-muted-foreground">{item.desc}</p>
            </div>
            <button
              onClick={() => toggle(item.key)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                perms[item.key] ? "bg-primary" : "bg-muted/70"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                  perms[item.key] ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </label>
        ))}
      </div>
    </div>
  );
}

function LarkHealthCheck() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    summary: { passed: number; total: number; ok: boolean };
    results: Record<string, { ok: boolean; detail: string; requiredScope: string }>;
    test_doc_url?: string | null;
  } | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/integrations/lark-user/health");
      const data = await res.json();
      setResult(data);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mt-3 rounded border border-border bg-card/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground/80">Health Check</span>
        <button
          onClick={run}
          disabled={running}
          className="rounded bg-muted/70 px-2 py-1 text-[10px] text-foreground hover:bg-muted disabled:opacity-50"
        >
          {running ? "Running…" : "Run checks"}
        </button>
      </div>
      {result && (
        <div className="mt-2 space-y-1">
          <p className={`text-xs ${result.summary.ok ? "text-emerald-400" : "text-amber-400"}`}>
            {result.summary.passed}/{result.summary.total} checks passed
          </p>
          <ul className="space-y-0.5 text-[11px]">
            {Object.entries(result.results).map(([key, r]) => (
              <li key={key} className="flex items-start gap-2">
                <span className={r.ok ? "text-emerald-500" : "text-red-400"}>{r.ok ? "✓" : "✗"}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-foreground/80">{key.replace(/_/g, " ")}</div>
                  <div className="text-muted-foreground text-[10px] truncate">
                    {r.detail}
                    {!r.ok && <span className="ml-2 text-amber-400">needs: {r.requiredScope}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {result.test_doc_url && (
            <p className="text-[10px] text-muted-foreground">
              Test artifacts created:{" "}
              <a href={result.test_doc_url} target="_blank" rel="noreferrer" className="text-primary underline">
                open test doc
              </a>
              {" "}(safe to delete)
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function GooglePermissions({ larkConnected }: { larkConnected: boolean }) {
  const [perms, setPerms] = useState<Record<string, boolean> | null>(null);
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/integrations/google/permissions")
      .then((r) => r.json())
      .then((d) => {
        setPerms(d.permissions ?? null);
        setDefaults(d.defaults ?? {});
      })
      .catch(() => {});
  }, []);

  async function save(updatedPerms: Record<string, boolean>, updatedDefaults: Record<string, string>) {
    setSaving(true);
    await fetch("/api/integrations/google/permissions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permissions: updatedPerms, defaults: updatedDefaults }),
    });
    setSaving(false);
  }

  function toggle(key: string) {
    if (!perms) return;
    const updated = { ...perms, [key]: !perms[key] };
    setPerms(updated);
    save(updated, defaults);
  }

  function setDefault(key: string, value: string) {
    const updated = { ...defaults, [key]: value };
    setDefaults(updated);
    if (perms) save(perms, updated);
  }

  if (!perms) return null;

  const items = [
    { key: "calendar", label: "Calendar", desc: "View & create calendar events", hasLark: true },
    { key: "freebusy", label: "Busy Status", desc: "Others can see if you're busy", hasLark: true },
    { key: "docs", label: "Docs", desc: "Create & read documents", hasLark: true },
    { key: "sheets", label: "Sheets", desc: "Read & write spreadsheets", hasLark: true },
    { key: "drive", label: "Drive", desc: "Upload & access files", hasLark: true },
    { key: "gmail", label: "Gmail", desc: "Read, send & draft emails", hasLark: false },
    { key: "contacts", label: "Contacts", desc: "Read your Google contacts", hasLark: false },
    { key: "tasks", label: "Tasks", desc: "Create & manage tasks", hasLark: false },
    { key: "meet", label: "Meet", desc: "Create Google Meet links", hasLark: false },
  ];

  return (
    <div className="mt-3 rounded border border-border bg-card/60 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-foreground/80">Permissions & Defaults</span>
        {saving && <span className="text-[10px] text-muted-foreground">Saving…</span>}
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <span className="text-xs text-foreground/80">{item.label}</span>
              <p className="text-[10px] text-muted-foreground">{item.desc}</p>
            </div>
            {item.hasLark && larkConnected ? (
              <select
                value={defaults[item.key] ?? "google"}
                onChange={(e) => setDefault(item.key, e.target.value)}
                className="rounded border border-border bg-muted px-2 py-1 text-[10px] text-foreground/80 outline-none"
              >
                <option value="google">Google</option>
                <option value="lark">Lark</option>
              </select>
            ) : (
              <span className="text-[10px] text-muted-foreground/70 shrink-0">Google only</span>
            )}
            <button
              onClick={() => toggle(item.key)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                perms[item.key] ? "bg-primary" : "bg-muted/70"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                  perms[item.key] ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function GoogleHealthCheck() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    summary: { passed: number; total: number; ok: boolean };
    results: Record<string, { ok: boolean; detail: string; scope: string }>;
  } | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/integrations/google/health");
      const data = await res.json();
      setResult(data);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mt-3 rounded border border-border bg-card/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground/80">Health Check</span>
        <button
          onClick={run}
          disabled={running}
          className="rounded bg-muted/70 px-2 py-1 text-[10px] text-foreground hover:bg-muted disabled:opacity-50"
        >
          {running ? "Running…" : "Run checks"}
        </button>
      </div>
      {result && (
        <div className="mt-2 space-y-1">
          <p className={`text-xs ${result.summary.ok ? "text-emerald-400" : "text-amber-400"}`}>
            {result.summary.passed}/{result.summary.total} checks passed
          </p>
          <ul className="space-y-0.5 text-[11px]">
            {Object.entries(result.results).map(([key, r]) => (
              <li key={key} className="flex items-start gap-2">
                <span className={r.ok ? "text-emerald-500" : "text-red-400"}>{r.ok ? "✓" : "✗"}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-foreground/80">{key.replace(/_/g, " ")}</div>
                  <div className="text-muted-foreground text-[10px] truncate">
                    {r.detail}
                    {!r.ok && <span className="ml-2 text-amber-400">scope: {r.scope}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
