/**
 * One-way memory mirror: pgvector → GitHub repo (Obsidian vault).
 *
 * After storeVectorMemory writes a row, we also write a markdown file
 * to a private GitHub repo via the Contents API. The user opens that
 * repo as an Obsidian vault locally; Obsidian Git plugin auto-pulls.
 *
 * Design choices:
 *   - Fire-and-forget. Sync failures must NEVER block a chat reply.
 *     Errors are logged once with a 30s dedup window.
 *   - Graceful no-op when GITHUB_VAULT_TOKEN / GITHUB_VAULT_REPO env
 *     vars are missing — same pattern as the Redis cache.
 *   - One commit per memory. Verbose history but clean diff per item;
 *     also makes git blame useful for "when did the AI say this."
 *
 * Path layout (decided with the user):
 *     {route}/{yyyy}/{mm}/{yyyy-mm-dd-HHMM}-{slug}.md
 *   e.g. personal/2026/05/2026-05-06-1947-tong-xin-asks-about-tasks.md
 *
 * Frontmatter: created, source, route, director_only, pgvector_id,
 * session_id, user, tags. All optional fields omitted when null/empty.
 */

const GITHUB_TOKEN = process.env.GITHUB_VAULT_TOKEN;
const REPO = process.env.GITHUB_VAULT_REPO; // "owner/repo"
const BRANCH = process.env.GITHUB_VAULT_BRANCH ?? "main";

export type VaultMemory = {
  /** pgvector row id — used for the back-link in frontmatter */
  id: string;
  /** Memory content; first ~60 chars become the filename slug */
  content: string;
  /** Where the memory came from. Free-form so future channels can self-tag. */
  source: string;
  /** "personal" or "company" — drives the top-level folder */
  route: "personal" | "company";
  /** Whether this memory is gated to directors */
  directorOnly?: boolean;
  /** Chat session that produced this memory (for replay/audit) */
  sessionId?: string | null;
  /** Whitelist name of the human user (for "who said it") */
  user?: string | null;
  /** Topic tags */
  tags?: string[];
  /** ISO timestamp; defaults to now */
  createdAt?: string;
};

let lastErrLog = 0;
function logErr(msg: string, err: unknown) {
  const now = Date.now();
  if (now - lastErrLog < 30_000) return;
  lastErrLog = now;
  console.warn(`[vault-sync] ${msg}:`, err instanceof Error ? err.message : err);
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "") // strip accents
      // Drop everything except letters/numbers/space/hyphen.
      // CJK is preserved by the unicode property — slugs in Chinese stay readable.
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "memory"
  );
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function buildPath(mem: VaultMemory): string {
  const d = new Date(mem.createdAt ?? Date.now());
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const HH = pad(d.getHours());
  const MM = pad(d.getMinutes());
  const slug = slugify(mem.content.slice(0, 80));
  return `${mem.route}/${yyyy}/${mm}/${yyyy}-${mm}-${dd}-${HH}${MM}-${slug}.md`;
}

function buildBody(mem: VaultMemory): string {
  // YAML frontmatter — Obsidian's dataview plugin parses this for queries.
  const lines: string[] = ["---"];
  lines.push(`created: ${mem.createdAt ?? new Date().toISOString()}`);
  lines.push(`source: ${mem.source}`);
  lines.push(`route: ${mem.route}`);
  lines.push(`director_only: ${!!mem.directorOnly}`);
  lines.push(`pgvector_id: ${mem.id}`);
  if (mem.sessionId) lines.push(`session_id: ${mem.sessionId}`);
  if (mem.user) lines.push(`user: ${mem.user}`);
  if (mem.tags && mem.tags.length > 0) {
    // YAML list inline form — short and human-editable.
    lines.push(`tags: [${mem.tags.map((t) => JSON.stringify(t)).join(", ")}]`);
  }
  lines.push("---");
  lines.push("");
  lines.push(mem.content);
  lines.push("");
  return lines.join("\n");
}

/** Base64 (UTF-8 safe) — GitHub Contents API requires base64-encoded content. */
function toBase64(text: string): string {
  // In Node + Edge runtimes, Buffer is available; in Edge-only runtimes, btoa
  // is. Use Buffer when present for proper UTF-8 handling.
  if (typeof Buffer !== "undefined") return Buffer.from(text, "utf-8").toString("base64");
  return btoa(unescape(encodeURIComponent(text)));
}

/**
 * Push the memory to the vault repo. Fire-and-forget — caller wraps with
 * `void syncToVault(...)` so awaitable failures don't bubble up.
 *
 * Idempotency: GitHub's Contents API rejects PUT if the path already
 * exists (without an `sha`). That's actually what we want — duplicate
 * memories with the exact same content+timestamp shouldn't appear twice.
 * The 422 response is silently swallowed.
 */
export async function syncToVault(mem: VaultMemory): Promise<void> {
  if (!GITHUB_TOKEN || !REPO) return;
  if (!mem.id || !mem.content?.trim()) return;

  try {
    const path = buildPath(mem);
    const body = buildBody(mem);
    const [owner, repo] = REPO.split("/");
    if (!owner || !repo) {
      logErr("config", `GITHUB_VAULT_REPO not in 'owner/repo' form: ${REPO}`);
      return;
    }

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`;
    const commitMsg = `mem: ${mem.route}/${path.split("/").pop()}`;

    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: commitMsg,
        content: toBase64(body),
        branch: BRANCH,
      }),
    });

    // 422 = path already exists with same hash — duplicate write, OK.
    if (res.status === 422) return;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logErr(`PUT ${res.status}`, text.slice(0, 200));
    }
  } catch (err) {
    logErr("fetch failed", err);
  }
}
