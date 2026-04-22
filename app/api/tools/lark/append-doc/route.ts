import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { larkAppendDoc } from "@/lib/lark-tools";
import { getFreshLarkToken } from "@/lib/lark-token";

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
  const fresh = await getFreshLarkToken(admin, user.id);
  if (!fresh) {
    return NextResponse.json({ error: "Lark token expired — please reconnect at /settings/integrations" }, { status: 400 });
  }

  const started = Date.now();
  const result = await larkAppendDoc({
    token: fresh.token,
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
