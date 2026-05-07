import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

/**
 * One-shot diagnostic for vault-sync auth/config problems.
 * Hits THREE GitHub endpoints in order and returns the verbatim status +
 * body of each so the caller can pinpoint exactly what's broken.
 *
 * GET /api/admin/vault-test
 *
 * Returns:
 *   - env presence
 *   - 1. GET /repos/{owner}/{repo}     → does the token see the repo?
 *   - 2. GET /repos/{owner}/{repo}/branches  → which branches exist?
 *   - 3. PUT a tiny test file at .vault-sync-test.md → can the token write?
 *
 * Read-only on first two probes; the third creates a small file you can
 * delete after. Director-only.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

async function requireDirector() {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("assistant_user_settings").select("role").eq("user_id", user.id).single();
  if (!settings || settings.role !== "director") {
    return { error: NextResponse.json({ error: "Directors only" }, { status: 403 }) };
  }
  return {};
}

function toBase64(text: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(text, "utf-8").toString("base64");
  return btoa(unescape(encodeURIComponent(text)));
}

export async function GET() {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;

  const token = process.env.GITHUB_VAULT_TOKEN;
  const repo = process.env.GITHUB_VAULT_REPO;
  const branch = process.env.GITHUB_VAULT_BRANCH ?? "main";

  if (!token || !repo) {
    return NextResponse.json({
      ok: false,
      where: "env",
      detail: { token_set: !!token, repo },
    });
  }

  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    return NextResponse.json({
      ok: false,
      where: "config",
      detail: `GITHUB_VAULT_REPO must be 'owner/repo', got: ${repo}`,
    });
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // Probe 1 — can the token see the repo at all?
  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${name}`, { headers });
  const repoBody = (await repoRes.json().catch(() => null)) as Record<string, unknown> | null;
  const probeRepo = {
    status: repoRes.status,
    visible: repoRes.ok,
    name: repoBody?.full_name,
    permissions: repoBody?.permissions, // { admin, push, pull } — push must be true
    default_branch: repoBody?.default_branch,
    error: repoRes.ok ? null : repoBody?.message,
  };

  // Probe 2 — does the configured branch exist?
  const branchRes = await fetch(
    `https://api.github.com/repos/${owner}/${name}/branches/${branch}`,
    { headers }
  );
  const branchBody = (await branchRes.json().catch(() => null)) as Record<string, unknown> | null;
  const probeBranch = {
    status: branchRes.status,
    exists: branchRes.ok,
    name: branchBody?.name,
    error: branchRes.ok ? null : branchBody?.message,
  };

  // Probe 3 — can we PUT a tiny test file?
  const testPath = ".vault-sync-test.md";
  const testBody = `Vault sync diagnostic OK at ${new Date().toISOString()}\n`;
  const putRes = await fetch(
    `https://api.github.com/repos/${owner}/${name}/contents/${testPath}`,
    {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "vault-sync diagnostic test",
        content: toBase64(testBody),
        branch,
      }),
    }
  );
  const putBodyText = await putRes.text();
  let putBody: unknown;
  try { putBody = JSON.parse(putBodyText); } catch { putBody = putBodyText.slice(0, 500); }
  const probePut = {
    status: putRes.status,
    ok: putRes.ok,
    detail: putBody,
  };

  return NextResponse.json({
    ok: probeRepo.visible && probeBranch.exists && putRes.ok,
    env: {
      GITHUB_VAULT_TOKEN_set: !!token,
      GITHUB_VAULT_REPO: repo,
      GITHUB_VAULT_BRANCH: branch,
    },
    probes: {
      repoVisible: probeRepo,
      branchExists: probeBranch,
      canWrite: probePut,
    },
  });
}
