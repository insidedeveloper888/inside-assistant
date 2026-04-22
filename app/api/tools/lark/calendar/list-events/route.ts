import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { larkListMyEvents } from "@/lib/lark-tools";
import { getFreshLarkToken } from "@/lib/lark-token";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { startTime, endTime } = await request.json();
  const admin = createAdminClient();
  const fresh = await getFreshLarkToken(admin, user.id);
  if (!fresh) {
    return NextResponse.json({ error: "Lark token expired — please reconnect at /settings/integrations" }, { status: 400 });
  }
  const result = await larkListMyEvents({
    token: fresh.token,
    startTime: new Date(startTime),
    endTime: new Date(endTime),
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ events: result.events });
}
