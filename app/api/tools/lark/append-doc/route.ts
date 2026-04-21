import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { larkAppendDoc } from "@/lib/lark-tools";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Append content to an existing Lark doc under the CURRENT user's token.
 * The doc must be owned by the user OR the user must have edit permission.
 * POST body: { documentId, content, sessionId? }
 */
export async function POST(request: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { documentId, content, sessionId } = await request.json();
  if (!documentId || typeof documentId !== "string") {
    return NextResponse.json({ error: "documentId required" }, { status: 400 });
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
    return NextResponse.json({ error: "Lark not connected" }, { status: 400 });
  }

  const started = Date.now();
  const result = await larkAppendDoc({
    token: integration.access_token as string,
    documentId,
    content,
  });

  await admin.from("tool_invocations").insert({
    user_id: user.id,
    session_id: sessionId ?? null,
    tool_name: "lark_append_doc",
    provider: "lark",
    input: { documentId, content_preview: content.slice(0, 500) },
    output: result.ok ? { ok: true } : null,
    status: result.ok ? "success" : "error",
    error: result.ok ? null : result.error,
    duration_ms: Date.now() - started,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true });
}
