import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { larkCreateDoc } from "@/lib/lark-tools";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Create a Lark doc using the CURRENT user's token.
 * Security: we fetch the token from user_integrations keyed by the session user_id.
 * No request-body user_id is ever honored — one user can't create under another's token.
 *
 * POST body: { title, content, folderToken? }
 * Returns: { url, documentId } on success.
 *
 * Logs an entry to tool_invocations regardless of outcome so we have an audit trail
 * of every AI/user-initiated Lark write. Content bodies are truncated in the log to
 * avoid keeping long sensitive drafts in the audit table.
 */
export async function POST(request: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { title, content, folderToken, sessionId } = await request.json();
  if (!title || typeof title !== "string") {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  if (!content || typeof content !== "string") {
    return NextResponse.json({ error: "content required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: integration } = await admin
    .from("user_integrations")
    .select("access_token")
    .eq("user_id", user.id)
    .eq("provider", "lark_user")
    .single();

  if (!integration?.access_token) {
    return NextResponse.json(
      { error: "Lark not connected — connect your personal Lark token at /settings/integrations" },
      { status: 400 }
    );
  }

  const started = Date.now();
  const result = await larkCreateDoc({
    token: integration.access_token as string,
    title,
    content,
    folderToken,
  });

  await admin.from("tool_invocations").insert({
    user_id: user.id,
    session_id: sessionId ?? null,
    tool_name: "lark_create_doc",
    provider: "lark",
    input: { title: title.slice(0, 200), content_preview: content.slice(0, 500), folderToken: folderToken ?? null },
    output: result.ok ? { url: result.url, documentId: result.documentId } : null,
    status: result.ok ? "success" : "error",
    error: result.ok ? null : result.error,
    duration_ms: Date.now() - started,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ url: result.url, documentId: result.documentId });
}
