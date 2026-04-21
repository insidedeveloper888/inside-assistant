import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { larkListMyEvents } from "@/lib/lark-tools";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { startTime, endTime } = await request.json();
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
  const result = await larkListMyEvents({
    token: integration.access_token as string,
    startTime: new Date(startTime),
    endTime: new Date(endTime),
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ events: result.events });
}
