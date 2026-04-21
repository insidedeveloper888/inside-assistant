import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { larkListImHistory } from "@/lib/lark-tools";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Read recent messages from a Lark chat (group or P2P) using the user's token.
 * The user must be a member of the chat; otherwise Lark returns 403.
 *
 * POST body: { chatId: "oc_..." | "ou_...", limit?: number }
 * Returns: { messages: [{ id, sender_id, create_time, text }, ...] }
 */
export async function POST(request: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chatId, limit } = await request.json();
  if (!chatId || typeof chatId !== "string") {
    return NextResponse.json({ error: "chatId required" }, { status: 400 });
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

  const result = await larkListImHistory({
    token: integration.access_token as string,
    chatId,
    limit,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  await admin.from("tool_invocations").insert({
    user_id: user.id,
    tool_name: "lark_im_history",
    provider: "lark",
    input: { chatId, limit: limit ?? 20 },
    output: { count: result.messages.length },
    status: "success",
    duration_ms: 0,
  });

  return NextResponse.json({ messages: result.messages });
}
