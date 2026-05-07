/**
 * Raw transcript mirror: every chat turn → GitHub vault as a markdown file.
 *
 * Distinct from vault-sync (which mirrors curated memories the AI chose to
 * remember). Transcripts capture the FULL exchange — user message + AI
 * reply verbatim — even when the AI didn't tag anything for memory.
 *
 * Path layout:
 *   transcripts/{yyyy}/{mm}/{yyyy-mm-dd}/{HHMM-SS}-{slug}.md
 *
 * Why a separate folder + flow:
 *   - Volume is ~10x higher than memories (every turn vs only memory-worthy)
 *   - User reads them as audit/replay, not as searchable notes
 *   - Different retention policy: transcripts could be pruned after N months
 *     while memories are forever
 *
 * Same env vars + auth pattern as vault-sync.ts. Same fire-and-forget
 * shape — async failures must never block a chat reply.
 */

const GITHUB_TOKEN = process.env.GITHUB_VAULT_TOKEN;
const REPO = process.env.GITHUB_VAULT_REPO;
const BRANCH = process.env.GITHUB_VAULT_BRANCH ?? "main";

export type Transcript = {
  /** Stable identifier for this turn — used for filename to make duplicates 422 (idempotent retry). */
  id: string;
  /**
   * Chat mode at the time of the turn. ONLY company-mode chats are
   * transcript-dumped to the vault — personal-mode is private, stays
   * in the messages/assistant_messages table only.
   */
  mode: "personal" | "company";
  /** What the user said */
  userMessage: string;
  /** What the AI replied (cleaned of internal tags) */
  aiReply: string;
  /** Origin */
  source: "web-chat" | "whatsapp";
  /** Memory routing decision the AI made (if any) — distinct from mode. */
  memoryRoute?: "personal" | "company" | null;
  /** Whitelist name of the human user */
  user?: string | null;
  /** Chat session id */
  sessionId?: string | null;
  /** ISO timestamp; defaults to now */
  createdAt?: string;
};

let lastErrLog = 0;
function logErr(msg: string, err: unknown) {
  const now = Date.now();
  if (now - lastErrLog < 30_000) return;
  lastErrLog = now;
  console.warn(`[transcript-sync] ${msg}:`, err instanceof Error ? err.message : err);
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "turn"
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

function buildPath(t: Transcript): string {
  const d = new Date(t.createdAt ?? Date.now());
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const HH = pad(d.getHours());
  const MM = pad(d.getMinutes());
  const SS = pad(d.getSeconds());
  const slug = slugify(t.userMessage.slice(0, 60));
  return `transcripts/${yyyy}/${mm}/${yyyy}-${mm}-${dd}/${HH}${MM}-${SS}-${slug}.md`;
}

function buildBody(t: Transcript): string {
  const created = t.createdAt ?? new Date().toISOString();
  const date = created.slice(0, 10); // yyyy-mm-dd
  const lines: string[] = ["---"];
  lines.push(`created: ${created}`);
  lines.push(`source: ${t.source}`);
  lines.push(`type: transcript`);
  if (t.memoryRoute) lines.push(`memory_route: ${t.memoryRoute}`);
  if (t.user) lines.push(`user: ${t.user}`);
  if (t.sessionId) lines.push(`session_id: ${t.sessionId}`);
  lines.push(`turn_id: ${t.id}`);
  lines.push("---");
  lines.push("");
  // Daily backlink — gives Obsidian's graph view a hub to cluster around.
  lines.push(`> Daily: [[daily/${date}]]`);
  lines.push("");
  lines.push("## User");
  lines.push("");
  lines.push(t.userMessage);
  lines.push("");
  lines.push("## Assistant");
  lines.push("");
  lines.push(t.aiReply);
  lines.push("");
  return lines.join("\n");
}

function toBase64(text: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(text, "utf-8").toString("base64");
  return btoa(unescape(encodeURIComponent(text)));
}

export type TranscriptSyncStatus =
  | "synced"
  | "skipped-no-config"
  | "skipped-empty"
  | "skipped-personal"
  | "skipped-duplicate"
  | "failed";

export async function syncTranscript(t: Transcript): Promise<TranscriptSyncStatus> {
  if (!GITHUB_TOKEN || !REPO) return "skipped-no-config";
  if (!t.id || !t.userMessage?.trim() || !t.aiReply?.trim()) return "skipped-empty";
  // Vault is the COMPANY brain. Personal-mode chats stay private.
  if (t.mode !== "company") return "skipped-personal";

  try {
    const path = buildPath(t);
    const body = buildBody(t);
    const [owner, repo] = REPO.split("/");
    if (!owner || !repo) {
      logErr("config", `GITHUB_VAULT_REPO not 'owner/repo': ${REPO}`);
      return "skipped-no-config";
    }
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `transcript: ${t.source} ${path.split("/").pop()}`,
        content: toBase64(body),
        branch: BRANCH,
      }),
    });
    if (res.status === 422) return "skipped-duplicate";
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logErr(`PUT ${res.status}`, text.slice(0, 200));
      return "failed";
    }
    return "synced";
  } catch (err) {
    logErr("fetch failed", err);
    return "failed";
  }
}
