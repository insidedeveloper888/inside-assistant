import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { larkCheckFreebusy } from "@/lib/lark-tools";

export const runtime = "nodejs";

/**
 * Check freebusy for team members. Uses the CURRENT user's Lark token to query —
 * Lark returns busy intervals only for users who've shared their calendar with
 * the tenant. No event titles are leaked — only busy/free.
 */
export async function POST(request: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userIds, startTime, endTime } = await request.json();
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return NextResponse.json({ error: "userIds (open_id[]) required" }, { status: 400 });
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

  const result = await larkCheckFreebusy({
    token: integration.access_token as string,
    userIds,
    startTime: new Date(startTime ?? Date.now()),
    endTime: new Date(endTime ?? Date.now() + 24 * 3600_000),
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ busy: result.busy });
}
