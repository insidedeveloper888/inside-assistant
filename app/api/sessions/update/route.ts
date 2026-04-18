import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId, title, claudeMd } = await request.json();
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify ownership
  const { data: session } = await admin
    .from("assistant_sessions")
    .select("user_id")
    .eq("id", sessionId)
    .single();

  if (!session || session.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updateData: Record<string, string> = {};
  if (title !== undefined) updateData.title = title;
  if (claudeMd !== undefined) updateData.claude_md = claudeMd;
  updateData.updated_at = new Date().toISOString();

  await admin
    .from("assistant_sessions")
    .update(updateData)
    .eq("id", sessionId);

  return NextResponse.json({ success: true });
}
