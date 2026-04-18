import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Fetch contacts from the WA Analyzer tables (Inside Advisory tenant)
  const { data: contacts } = await admin
    .from("contacts")
    .select("id, wa_id, phone, push_name, custom_name, current_score, stage, last_seen_at")
    .eq("tenant_id", "61c2f8b0-97b0-4311-8302-3dc683ac9a26")
    .order("last_seen_at", { ascending: false });

  return NextResponse.json({ contacts: contacts ?? [] });
}
